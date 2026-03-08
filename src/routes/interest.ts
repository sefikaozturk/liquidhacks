import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { interest } from '../db/schema.js';

const interestRouter = new Hono();

interestRouter.post('/', async (c) => {
  const body = await c.req.json();
  const { email, name, intent, apis, budget } = body;

  if (!email || !intent || !apis || !budget) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Invalid email' }, 400);
  }

  if (!['buying', 'selling', 'both'].includes(intent)) {
    return c.json({ error: 'Intent must be buying, selling, or both' }, 400);
  }

  const inserted = await db.insert(interest).values({
    email,
    name: name || null,
    intent,
    apis: Array.isArray(apis) ? apis.join(',') : apis,
    budget,
  }).returning();

  return c.json(inserted[0], 201);
});

// Unsubscribe via email token (token = interest row ID)
interestRouter.get('/unsubscribe', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.json({ error: 'Missing token' }, 400);

  try {
    await db.update(interest)
      .set({ unsubscribed: true })
      .where(eq(interest.id, token));
  } catch {
    // Invalid UUID or not found — still show success to avoid info leak
  }

  return c.html('<html><body style="background:#111;color:#ccc;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><h2>unsubscribed</h2><p>you won\'t receive further emails from liquidhacks.</p><a href="/" style="color:#0ff">back to home</a></div></body></html>');
});

export default interestRouter;
