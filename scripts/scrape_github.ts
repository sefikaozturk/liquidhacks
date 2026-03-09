/**
 * GitHub-native hackathon participant scraper
 *
 * Discovers hackathon builders directly via GitHub Search — no Devpost needed.
 * Searches for repos with hackathon-related topics/keywords, extracts contributors,
 * then mines emails from profiles + commit history.
 *
 * Results are upserted into the github_profiles table.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_xxx DATABASE_URL=postgres://... npx tsx scripts/scrape_github.ts
 *   GITHUB_TOKEN=... DATABASE_URL=... npx tsx scripts/scrape_github.ts --query "hackathon 2025" --max 500
 *   GITHUB_TOKEN=... DATABASE_URL=... npx tsx scripts/scrape_github.ts --dry-run
 *
 * Options:
 *   --query "string"    Custom GitHub search query (default: preset hackathon queries)
 *   --max N             Max contributors to collect (default: 1000)
 *   --dry-run           Print results without writing to DB
 *   --no-commits        Skip mining commit emails (faster, less coverage)
 */

import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_COMMITS = process.argv.includes('--no-commits');
const MAX_ARG = process.argv.indexOf('--max');
const MAX_USERS = MAX_ARG !== -1 ? parseInt(process.argv[MAX_ARG + 1], 10) : 1000;
const QUERY_ARG = process.argv.indexOf('--query');
const CUSTOM_QUERY = QUERY_ARG !== -1 ? process.argv[QUERY_ARG + 1] : null;

if (!GITHUB_TOKEN) {
  console.error('GITHUB_TOKEN is required (rate limit: 60/hr without it, 5000/hr with it)');
  process.exit(1);
}
if (!DATABASE_URL && !DRY_RUN) {
  console.error('DATABASE_URL is required (or use --dry-run)');
  process.exit(1);
}

const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'liquidhacks-growth-agent',
};

// GitHub search queries to find hackathon repos
const DEFAULT_QUERIES = [
  'topic:hackathon stars:1..50 pushed:>2024-01-01',
  'topic:hacktoberfest topic:hackathon',
  '"hackathon winner" in:readme stars:1..30 pushed:>2024-01-01',
  '"built at" "hackathon" in:readme stars:1..20 pushed:>2024-01-01',
  '"submitted to" devpost in:readme stars:1..20',
  'topic:mlh-fellowship pushed:>2024-01-01',
  'topic:treehacks OR topic:hackmit OR topic:pennapps stars:1..50',
];

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ghFetch(url: string, params?: Record<string, string>): Promise<{ data: any; remaining: number; nextUrl: string | null }> {
  const fullUrl = params
    ? `${url}?${new URLSearchParams(params)}`
    : url;

  const res = await fetch(fullUrl, { headers: GH_HEADERS });
  const remaining = parseInt(res.headers.get('x-ratelimit-remaining') || '999', 10);

  // Handle rate limiting
  if (res.status === 403 || res.status === 429) {
    const resetAt = parseInt(res.headers.get('x-ratelimit-reset') || '0', 10) * 1000;
    const waitMs = Math.max(resetAt - Date.now(), 10_000);
    console.warn(`\nRate limited. Waiting ${Math.ceil(waitMs / 1000)}s...`);
    await sleep(waitMs);
    return ghFetch(url, params);
  }

  if (res.status === 422) {
    // Search API: only first 1000 results accessible
    return { data: null, remaining, nextUrl: null };
  }

  if (!res.ok) {
    return { data: null, remaining, nextUrl: null };
  }

  // Parse Link header for pagination
  let nextUrl: string | null = null;
  const link = res.headers.get('link') || '';
  const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
  if (nextMatch) nextUrl = nextMatch[1];

  const data = await res.json();
  return { data, remaining, nextUrl };
}

/** Search GitHub repos matching a query. Returns repo full_names. */
async function searchRepos(query: string, maxRepos: number = 200): Promise<string[]> {
  const repos: string[] = [];
  let page = 1;

  while (repos.length < maxRepos) {
    const { data, remaining } = await ghFetch('https://api.github.com/search/repositories', {
      q: query,
      sort: 'updated',
      per_page: '100',
      page: String(page),
    });

    if (!data?.items?.length) break;

    for (const repo of data.items) {
      repos.push(repo.full_name);
    }

    process.stdout.write(`\r  repos found: ${repos.length} (rate: ${remaining} remaining)   `);

    if (!data.items || data.items.length < 100) break;
    page++;

    // GitHub Search API caps at 1000 results
    if (page > 10) break;

    // Search API has stricter limits: max ~30 req/min
    await sleep(2000);
  }

  return repos;
}

/** Get contributors for a repo. Returns list of {login, contributions}. */
async function getContributors(repoFullName: string): Promise<string[]> {
  const { data } = await ghFetch(`https://api.github.com/repos/${repoFullName}/contributors`, {
    per_page: '100',
    anon: '0',
  });

  if (!Array.isArray(data)) return [];
  return data.map((c: any) => c.login).filter(Boolean);
}

/** Fetch public profile for a GitHub username. */
async function getProfile(username: string): Promise<{
  username: string;
  email: string | null;
  name: string | null;
  bio: string | null;
  location: string | null;
}> {
  const { data } = await ghFetch(`https://api.github.com/users/${encodeURIComponent(username)}`);
  return {
    username,
    email: data?.email || null,
    name: data?.name || null,
    bio: data?.bio || null,
    location: data?.location || null,
  };
}

/** Mine commit emails from public push events. */
async function mineCommitEmail(username: string): Promise<string | null> {
  const { data } = await ghFetch(
    `https://api.github.com/users/${encodeURIComponent(username)}/events/public`,
    { per_page: '100' }
  );

  if (!Array.isArray(data)) return null;

  for (const event of data) {
    if (event.type !== 'PushEvent') continue;
    for (const commit of event.payload?.commits || []) {
      const email: string = commit.author?.email || '';
      if (
        email &&
        email.includes('@') &&
        !email.endsWith('@users.noreply.github.com') &&
        !email.includes('noreply')
      ) {
        return email;
      }
    }
  }
  return null;
}

/** Upsert a profile into github_profiles table. */
async function upsertProfile(
  db: postgres.Sql,
  profile: { username: string; email: string | null; name: string | null; bio: string | null; location: string | null }
) {
  await db`
    INSERT INTO github_profiles (username, email, name, bio, location, fetched_at)
    VALUES (${profile.username}, ${profile.email}, ${profile.name}, ${profile.bio}, ${profile.location}, NOW())
    ON CONFLICT (username) DO UPDATE SET
      email      = COALESCE(EXCLUDED.email, github_profiles.email),
      name       = COALESCE(EXCLUDED.name, github_profiles.name),
      bio        = COALESCE(EXCLUDED.bio, github_profiles.bio),
      location   = COALESCE(EXCLUDED.location, github_profiles.location),
      fetched_at = NOW()
  `;
}

/** Load already-fetched usernames from DB. */
async function getAlreadyFetched(db: postgres.Sql): Promise<Set<string>> {
  const rows = await db`SELECT username FROM github_profiles`;
  return new Set((rows as any[]).map((r) => r.username.toLowerCase()));
}

async function main() {
  const db = DATABASE_URL && !DRY_RUN ? postgres(DATABASE_URL) : null;

  const alreadyFetched = db ? await getAlreadyFetched(db) : new Set<string>();
  console.log(`${alreadyFetched.size} profiles already in DB`);

  const queries = CUSTOM_QUERY ? [CUSTOM_QUERY] : DEFAULT_QUERIES;

  // Phase 1: collect unique usernames from repo contributors
  const allUsernames = new Set<string>();

  for (const query of queries) {
    console.log(`\nSearching: "${query}"`);
    const repos = await searchRepos(query, 200);
    console.log(`\n  → ${repos.length} repos`);

    for (const [i, repo] of repos.entries()) {
      const contributors = await getContributors(repo);
      for (const login of contributors) {
        if (!alreadyFetched.has(login.toLowerCase())) {
          allUsernames.add(login);
        }
      }
      process.stdout.write(`\r  processing repos: ${i + 1}/${repos.length}, unique new users: ${allUsernames.size}   `);
      await sleep(300);

      if (allUsernames.size >= MAX_USERS) break;
    }

    if (allUsernames.size >= MAX_USERS) break;
  }

  const todo = [...allUsernames].slice(0, MAX_USERS);
  console.log(`\n\nPhase 1 done. ${todo.length} new users to enrich.\n`);

  if (DRY_RUN) {
    console.log('Dry run — first 20 users:', todo.slice(0, 20));
    return;
  }

  // Phase 2: enrich each user with profile + commit email
  let fetched = 0;
  let withEmail = 0;

  for (const username of todo) {
    try {
      const profile = await getProfile(username);

      if (!profile.email && !SKIP_COMMITS) {
        profile.email = await mineCommitEmail(username);
      }

      await upsertProfile(db!, profile);

      fetched++;
      if (profile.email) withEmail++;

      const pct = ((fetched / todo.length) * 100).toFixed(1);
      process.stdout.write(
        `\r[${pct}%] ${fetched}/${todo.length} enriched, ${withEmail} with email   `
      );

      await sleep(400);
    } catch (err) {
      console.error(`\nError enriching ${username}:`, err);
    }
  }

  console.log(`\n\nDone. ${fetched} profiles saved, ${withEmail} with real email.`);
  await db!.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
