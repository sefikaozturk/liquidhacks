import { Hono } from 'hono';
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

export default interestRouter;
