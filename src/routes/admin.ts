import { Hono } from 'hono';
import { eq, count } from 'drizzle-orm';
import { db, client } from '../db/index.js';
import { users, listings, interest } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { sendEmail } from '../lib/email.js';
import fs from 'fs';
import path from 'path';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'sefikaozturk';

const adminRouter = new Hono();

// All admin routes require auth + admin check
adminRouter.use('/*', requireAuth);
adminRouter.use('/*', async (c, next) => {
  const user = c.get('user')!;
  const rows = await db.select({ username: users.username })
    .from(users).where(eq(users.id, user.sub)).limit(1);
  if (!rows.length || rows[0].username !== ADMIN_USERNAME) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  await next();
});

// Site analytics
adminRouter.get('/stats', async (c) => {
  const [userCount] = await db.select({ count: count() }).from(users);
  const [listingCount] = await db.select({ count: count() }).from(listings);

  const byType = await client`SELECT type, count(*)::int FROM listings GROUP BY type`;
  const byProvider = await client`
    SELECT provider, count(*)::int as count FROM listings
    GROUP BY provider ORDER BY count DESC LIMIT 10
  `;

  let byStatus: { status: string; count: number }[] = [];
  try {
    byStatus = await client`SELECT status, count(*)::int FROM listings GROUP BY status`;
  } catch {
    // status column may not exist yet
  }

  // Funnel metrics
  const [interestCount] = await db.select({ count: count() }).from(interest);

  let emailStats = { sent: 0, opened: 0, clicked: 0, bounced: 0 };
  try {
    const rows = await client`SELECT status, count(*)::int FROM outreach_emails GROUP BY status`;
    for (const r of rows as any[]) emailStats[r.status as keyof typeof emailStats] = r.count;
  } catch { /* table may not exist */ }

  let verificationBreakdown: any[] = [];
  try {
    verificationBreakdown = await client`SELECT verification_level, count(*)::int FROM users GROUP BY verification_level`;
  } catch { /* column may not exist */ }

  return c.json({
    users: userCount.count,
    listings: listingCount.count,
    interest: interestCount.count,
    byType: Object.fromEntries((byType as any[]).map(r => [r.type, r.count])),
    byStatus: Object.fromEntries((byStatus as any[]).map(r => [r.status, r.count])),
    byProvider: (byProvider as any[]).map(r => ({ provider: r.provider, count: r.count })),
    emailStats,
    verificationBreakdown: Object.fromEntries((verificationBreakdown as any[]).map(r => [r.verification_level, r.count])),
  });
});

// Growth agent contacts
adminRouter.get('/growth', async (c) => {
  const jsonPath = path.join(process.cwd(), 'hackathon_winners.json');

  let projects: any[] = [];
  try {
    projects = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
  } catch {
    return c.json({ error: 'Growth data not found. Run scrape.py first.' }, 404);
  }

  // Load outreach status
  let outreachRows: any[] = [];
  try {
    outreachRows = await client`SELECT devpost_profile, reached_out_at FROM outreach`;
  } catch { /* table may not exist yet */ }
  const outreached = new Map(outreachRows.map((r: any) => [r.devpost_profile, r.reached_out_at]));

  // Flatten projects → one row per team member
  const contacts: any[] = [];
  for (const p of projects) {
    for (const m of (p.team_members || [])) {
      if (!m.name || m.name.startsWith('http')) continue;
      const profile = m.devpost_url || m.devpost_profile || '';
      const hasContact = m.email || m.linkedin || m.twitter || m.github;
      contacts.push({
        name: m.name,
        devpost_profile: profile,
        hackathon: p.hackathon || '',
        project_title: p.title || '',
        project_url: p.url || '',
        prize: (p.prize_details?.[0] || p.prizes?.[0] || '').toString().slice(0, 40),
        github: m.github || '',
        linkedin: m.linkedin || '',
        twitter: m.twitter || '',
        email: m.email || '',
        has_contact: !!hasContact,
        reached_out: outreached.has(profile),
        reached_out_at: outreached.get(profile) || null,
      });
    }
  }

  return c.json({ contacts: contacts.slice(0, 50), total: contacts.length });
});

// Mark as reached out
adminRouter.post('/growth/outreach', async (c) => {
  const { devpost_profile } = await c.req.json();
  if (!devpost_profile) return c.json({ error: 'Missing devpost_profile' }, 400);

  await client`
    INSERT INTO outreach (devpost_profile) VALUES (${devpost_profile})
    ON CONFLICT (devpost_profile) DO NOTHING
  `;

  return c.json({ ok: true });
});

// Send email (admin outreach)
adminRouter.post('/test-email', async (c) => {
  const { to, subject, html } = await c.req.json();
  if (!to) return c.json({ error: 'Missing "to" address' }, 400);

  const result = await sendEmail({
    to,
    subject: subject || 'LiquidHacks — test email',
    html: html || `<div style="font-family:monospace;padding:20px;background:#0d0d0d;color:#e8e8e8;">
      <h2 style="color:#39ff14;">it works.</h2>
      <p>this is a test email from <a href="https://liquidhacks.dev" style="color:#39ff14;">liquidhacks.dev</a>.</p>
    </div>`,
    replyTo: 'hello@liquidhacks.dev',
  });

  if (!result) return c.json({ error: 'Failed to send — check RESEND_API_KEY and domain verification' }, 500);
  return c.json({ ok: true, resendId: result.id });
});

export default adminRouter;
