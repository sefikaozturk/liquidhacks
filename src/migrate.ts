import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  console.log('Running migrations...');

  await sql`
    ALTER TABLE listings
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS direct_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      sender_id uuid NOT NULL REFERENCES users(id),
      receiver_id uuid NOT NULL REFERENCES users(id),
      body text NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS dm_conv_idx
    ON direct_messages (sender_id, receiver_id, created_at)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS outreach (
      devpost_profile text PRIMARY KEY,
      reached_out_at timestamp DEFAULT now() NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS interest (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text NOT NULL,
      name text,
      intent text NOT NULL,
      apis text NOT NULL,
      budget text NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL
    )
  `;

  // Escrow: add stripe fields to users
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_account_id text`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_onboarded boolean NOT NULL DEFAULT false`;

  // Escrow: transactions table
  await sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id uuid NOT NULL REFERENCES listings(id),
      buyer_id uuid NOT NULL REFERENCES users(id),
      seller_id uuid NOT NULL REFERENCES users(id),
      amount_cents integer NOT NULL,
      platform_fee_cents integer NOT NULL,
      seller_payout_cents integer NOT NULL,
      status text NOT NULL DEFAULT 'pending_payment',
      stripe_payment_intent_id text,
      stripe_transfer_id text,
      auto_release_at timestamp,
      dispute_reason text,
      created_at timestamp DEFAULT now() NOT NULL,
      updated_at timestamp DEFAULT now() NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS tx_listing_buyer_idx ON transactions (listing_id, buyer_id)`;
  await sql`CREATE INDEX IF NOT EXISTS tx_status_idx ON transactions (status)`;

  // Phase 2-4: Growth, analytics, fraud prevention
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_level text NOT NULL DEFAULT 'none'`;
  await sql`ALTER TABLE listings ADD COLUMN IF NOT EXISTS proof_verified boolean NOT NULL DEFAULT false`;
  await sql`ALTER TABLE interest ADD COLUMN IF NOT EXISTS unsubscribed boolean NOT NULL DEFAULT false`;

  await sql`
    CREATE TABLE IF NOT EXISTS outreach_emails (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      recipient_email text NOT NULL,
      recipient_name text,
      subject text NOT NULL,
      status text NOT NULL DEFAULT 'queued',
      resend_id text,
      source text NOT NULL,
      utm_campaign text,
      sent_at timestamp,
      opened_at timestamp,
      clicked_at timestamp,
      created_at timestamp DEFAULT now() NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS user_attribution (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL REFERENCES users(id),
      utm_source text,
      utm_medium text,
      utm_campaign text,
      referrer text,
      created_at timestamp DEFAULT now() NOT NULL
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS github_profiles (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      username text UNIQUE NOT NULL,
      email text,
      name text,
      bio text,
      location text,
      fetched_at timestamp DEFAULT now() NOT NULL
    )
  `;

  console.log('Migrations done');
  await sql.end();
}

main().catch(e => { console.error('Migration failed:', e); process.exit(1); });
