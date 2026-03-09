/**
 * GitHub email enrichment script
 *
 * For each contact in hackathon_winners.json that has a GitHub username,
 * fetches their public profile + commit events to find real email addresses,
 * then upserts into the github_profiles table.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx DATABASE_URL=postgres://... npx tsx scripts/enrich-github.ts
 *
 * Rate limits:
 *   - Authenticated: 5000 req/hr
 *   - Script uses 2 requests per user (profile + events), so ~2500 users/hr
 *   - Add --dry-run to just print what would be fetched without hitting DB
 */

import postgres from 'postgres';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATABASE_URL = process.env.DATABASE_URL;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DRY_RUN = process.argv.includes('--dry-run');

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

if (!GITHUB_TOKEN) {
  console.warn('Warning: GITHUB_TOKEN not set — rate limited to 60 req/hr. Set it for 5000 req/hr.');
}

const client = postgres(DATABASE_URL);

const GH_HEADERS: Record<string, string> = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'liquidhacks-growth-agent',
  ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
};

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ghFetch(url: string): Promise<{ data: any; remaining: number }> {
  const res = await fetch(url, { headers: GH_HEADERS });
  const remaining = parseInt(res.headers.get('x-ratelimit-remaining') || '999', 10);

  if (res.status === 404) return { data: null, remaining };
  if (res.status === 403 || res.status === 429) {
    const resetAt = parseInt(res.headers.get('x-ratelimit-reset') || '0', 10) * 1000;
    const waitMs = Math.max(resetAt - Date.now(), 5000);
    console.warn(`Rate limited. Waiting ${Math.ceil(waitMs / 1000)}s...`);
    await sleep(waitMs);
    return ghFetch(url); // retry once
  }
  if (!res.ok) return { data: null, remaining };

  const data = await res.json();
  return { data, remaining };
}

/** Extract a real email from GitHub public events (PushEvents contain commit author emails) */
async function extractEmailFromEvents(username: string): Promise<string | null> {
  const { data: events } = await ghFetch(
    `https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=100`
  );
  if (!Array.isArray(events)) return null;

  for (const event of events) {
    if (event.type !== 'PushEvent') continue;
    for (const commit of event.payload?.commits || []) {
      const email: string = commit.author?.email || '';
      if (
        email &&
        !email.endsWith('@users.noreply.github.com') &&
        !email.includes('noreply') &&
        email.includes('@')
      ) {
        return email;
      }
    }
  }
  return null;
}

async function upsertProfile(profile: {
  username: string;
  email: string | null;
  name: string | null;
  bio: string | null;
  location: string | null;
}) {
  await client`
    INSERT INTO github_profiles (username, email, name, bio, location, fetched_at)
    VALUES (
      ${profile.username},
      ${profile.email},
      ${profile.name},
      ${profile.bio},
      ${profile.location},
      NOW()
    )
    ON CONFLICT (username) DO UPDATE SET
      email     = COALESCE(EXCLUDED.email, github_profiles.email),
      name      = COALESCE(EXCLUDED.name, github_profiles.name),
      bio       = COALESCE(EXCLUDED.bio, github_profiles.bio),
      location  = COALESCE(EXCLUDED.location, github_profiles.location),
      fetched_at = NOW()
  `;
}

async function getAlreadyFetched(): Promise<Set<string>> {
  const rows = await client`SELECT username FROM github_profiles`;
  return new Set(rows.map((r: any) => r.username.toLowerCase()));
}

async function main() {
  const jsonPath = path.join(__dirname, '..', 'hackathon_winners.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('hackathon_winners.json not found. Run scrape.py first.');
    process.exit(1);
  }

  const projects: any[] = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  // Collect unique GitHub usernames from all team members
  const usernameMap = new Map<string, string>(); // lowercase → original
  for (const p of projects) {
    for (const m of p.team_members || []) {
      const gh: string = m.github || m.member_github || '';
      if (!gh) continue;
      // Accept full URLs or bare usernames
      const match = gh.match(/github\.com\/([^/?#]+)/i);
      const username = match ? match[1] : gh.trim();
      if (username && !username.startsWith('http')) {
        usernameMap.set(username.toLowerCase(), username);
      }
    }
  }

  console.log(`Found ${usernameMap.size} unique GitHub usernames in hackathon_winners.json`);

  const alreadyFetched = await getAlreadyFetched();
  const todo = [...usernameMap.values()].filter((u) => !alreadyFetched.has(u.toLowerCase()));
  console.log(`${alreadyFetched.size} already in DB. Processing ${todo.size ?? todo.length} new usernames.`);

  if (DRY_RUN) {
    console.log('Dry run — first 10 usernames to fetch:', todo.slice(0, 10));
    await client.end();
    return;
  }

  let fetched = 0;
  let withEmail = 0;
  let errors = 0;

  for (const username of todo) {
    try {
      // 1. Public profile
      const { data: profile, remaining } = await ghFetch(
        `https://api.github.com/users/${encodeURIComponent(username)}`
      );

      let email: string | null = profile?.email || null;
      const name: string | null = profile?.name || null;
      const bio: string | null = profile?.bio || null;
      const location: string | null = profile?.location || null;

      // 2. If no public email, mine from commit events
      if (!email) {
        email = await extractEmailFromEvents(username);
      }

      await upsertProfile({ username, email, name, bio, location });

      fetched++;
      if (email) withEmail++;

      const pct = ((fetched / todo.length) * 100).toFixed(1);
      process.stdout.write(`\r[${pct}%] ${fetched}/${todo.length} fetched, ${withEmail} with email (rate limit remaining: ${remaining})   `);

      // Throttle: stay comfortably under rate limit
      // 2 req/user, target ~1 req/sec → 500ms between users
      await sleep(500);
    } catch (err) {
      errors++;
      console.error(`\nError fetching ${username}:`, err);
    }
  }

  console.log(`\n\nDone. ${fetched} fetched, ${withEmail} with email, ${errors} errors.`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
