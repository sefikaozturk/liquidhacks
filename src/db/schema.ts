import { pgTable, uuid, integer, text, timestamp, index, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  githubId: integer('github_id').unique().notNull(),
  username: text('username').notNull(),
  avatarUrl: text('avatar_url'),
  stripeAccountId: text('stripe_account_id'),
  stripeOnboarded: boolean('stripe_onboarded').default(false).notNull(),
  verificationLevel: text('verification_level').default('none').notNull(), // 'none' | 'github_verified' | 'proof_submitted' | 'admin_verified'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const listings = pgTable('listings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  type: text('type').notNull(), // 'selling' | 'buying'
  provider: text('provider').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  faceValue: integer('face_value'), // cents
  askingPrice: integer('asking_price').notNull(), // cents
  creditType: text('credit_type').notNull(), // 'redemption code' | 'API key' | 'account login' | 'org invite'
  proofLink: text('proof_link'),
  proofVerified: boolean('proof_verified').default(false).notNull(),
  contactInfo: text('contact_info').notNull(),
  status: text('status').default('active').notNull(), // 'active' | 'traded'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const directMessages = pgTable('direct_messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  senderId: uuid('sender_id').references(() => users.id).notNull(),
  receiverId: uuid('receiver_id').references(() => users.id).notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('dm_conv_idx').on(table.senderId, table.receiverId, table.createdAt),
]);

export const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  listingId: uuid('listing_id').references(() => listings.id, { onDelete: 'cascade' }).notNull(),
  senderId: uuid('sender_id').references(() => users.id).notNull(),
  buyerId: uuid('buyer_id').references(() => users.id).notNull(),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => [
  index('messages_conv_idx').on(table.listingId, table.buyerId, table.createdAt),
]);

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  listingId: uuid('listing_id').references(() => listings.id).notNull(),
  buyerId: uuid('buyer_id').references(() => users.id).notNull(),
  sellerId: uuid('seller_id').references(() => users.id).notNull(),
  amountCents: integer('amount_cents').notNull(),
  platformFeeCents: integer('platform_fee_cents').notNull(),
  sellerPayoutCents: integer('seller_payout_cents').notNull(),
  status: text('status').default('pending_payment').notNull(),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  stripeTransferId: text('stripe_transfer_id'),
  autoReleaseAt: timestamp('auto_release_at'),
  disputeReason: text('dispute_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => [
  index('tx_listing_buyer_idx').on(table.listingId, table.buyerId),
  index('tx_status_idx').on(table.status),
]);

export const interest = pgTable('interest', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name'),
  intent: text('intent').notNull(), // 'buying' | 'selling' | 'both'
  apis: text('apis').notNull(), // comma-separated: 'OpenAI,Anthropic,...'
  budget: text('budget').notNull(), // '$0-100' | '$100-500' | '$500-2k' | '$2k+'
  unsubscribed: boolean('unsubscribed').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const outreachEmails = pgTable('outreach_emails', {
  id: uuid('id').primaryKey().defaultRandom(),
  recipientEmail: text('recipient_email').notNull(),
  recipientName: text('recipient_name'),
  subject: text('subject').notNull(),
  status: text('status').default('queued').notNull(), // 'queued' | 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced'
  resendId: text('resend_id'),
  source: text('source').notNull(), // 'hackathon_scrape' | 'manual' | 'interest_followup'
  utmCampaign: text('utm_campaign'),
  sentAt: timestamp('sent_at'),
  openedAt: timestamp('opened_at'),
  clickedAt: timestamp('clicked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const userAttribution = pgTable('user_attribution', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  utmSource: text('utm_source'),
  utmMedium: text('utm_medium'),
  utmCampaign: text('utm_campaign'),
  referrer: text('referrer'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const githubProfiles = pgTable('github_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: text('username').unique().notNull(),
  email: text('email'),
  name: text('name'),
  bio: text('bio'),
  location: text('location'),
  fetchedAt: timestamp('fetched_at').defaultNow().notNull(),
});
