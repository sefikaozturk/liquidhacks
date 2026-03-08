import { Hono } from 'hono';
import { client } from '../db/index.js';

const webhooksRouter = new Hono();

// Resend webhook — updates outreach_emails status on delivery/open/click events
webhooksRouter.post('/resend', async (c) => {
  const body = await c.req.json();
  const { type, data } = body;

  if (!data?.email_id) return c.json({ ok: true });

  const resendId = data.email_id;

  try {
    switch (type) {
      case 'email.delivered':
        await client`UPDATE outreach_emails SET status = 'delivered' WHERE resend_id = ${resendId}`;
        break;
      case 'email.opened':
        await client`UPDATE outreach_emails SET status = 'opened', opened_at = now() WHERE resend_id = ${resendId}`;
        break;
      case 'email.clicked':
        await client`UPDATE outreach_emails SET status = 'clicked', clicked_at = now() WHERE resend_id = ${resendId}`;
        break;
      case 'email.bounced':
        await client`UPDATE outreach_emails SET status = 'bounced' WHERE resend_id = ${resendId}`;
        break;
    }
  } catch (e) {
    console.error('Webhook processing error:', e);
  }

  return c.json({ ok: true });
});

export default webhooksRouter;
