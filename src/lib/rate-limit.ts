import type { Context, Next } from 'hono';

const store = new Map<string, number[]>();

// Clean old entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [key, timestamps] of store) {
    const filtered = timestamps.filter(t => t > cutoff);
    if (filtered.length === 0) store.delete(key);
    else store.set(key, filtered);
  }
}, 300_000);

export function rateLimit(maxRequests: number, windowMs: number = 60_000) {
  return async (c: Context, next: Next) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const key = `${c.req.path}:${ip}`;
    const now = Date.now();
    const cutoff = now - windowMs;

    const timestamps = (store.get(key) || []).filter(t => t > cutoff);
    if (timestamps.length >= maxRequests) {
      return c.json({ error: 'Too many requests' }, 429);
    }

    timestamps.push(now);
    store.set(key, timestamps);
    await next();
  };
}
