import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  console.log('Seeding...');

  await sql`
    INSERT INTO users (id, github_id, username, avatar_url, stripe_onboarded)
    VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', 99990001, 'hackerman', 'https://api.dicebear.com/7.x/pixel-art/svg?seed=hackerman', true),
      ('aaaaaaaa-0000-0000-0000-000000000002', 99990002, 'api_flipper', 'https://api.dicebear.com/7.x/pixel-art/svg?seed=apiflip', true),
      ('aaaaaaaa-0000-0000-0000-000000000003', 99990003, 'cloud_dumper', 'https://api.dicebear.com/7.x/pixel-art/svg?seed=clouddump', false),
      ('aaaaaaaa-0000-0000-0000-000000000004', 99990004, 'creditwhale', 'https://api.dicebear.com/7.x/pixel-art/svg?seed=whale', true),
      ('aaaaaaaa-0000-0000-0000-000000000005', 99990005, 'nix_dev', 'https://api.dicebear.com/7.x/pixel-art/svg?seed=nixdev', false)
    ON CONFLICT (github_id) DO NOTHING
  `;

  const seedListings = [
    { userId: 'aaaaaaaa-0000-0000-0000-000000000001', type: 'selling', provider: 'OpenAI', title: '$1,000 OpenAI credits from HackMIT 2025', description: 'Won 1st place at HackMIT. Credits expire Dec 2026. Full API access, GPT-4o + o1. Can transfer via org invite.', faceValue: 100000, askingPrice: 45000, creditType: 'org invite', proofLink: 'https://devpost.com/software/hackerman-project', contactInfo: 'telegram: @hackerman_trades' },
    { userId: 'aaaaaaaa-0000-0000-0000-000000000001', type: 'selling', provider: 'Anthropic', title: '$500 Anthropic API credits — TreeHacks', description: 'Claude 3.5 Sonnet + Opus access. Got these from Anthropic sponsor prize at TreeHacks. Transferable via API key rotation.', faceValue: 50000, askingPrice: 25000, creditType: 'API key', proofLink: 'https://devpost.com/software/treehacks-winner', contactInfo: 'discord: hackerman#0001' },
    { userId: 'aaaaaaaa-0000-0000-0000-000000000002', type: 'selling', provider: 'Google Cloud', title: '$2,000 GCP credits — PennApps', description: 'Google Cloud credits from PennApps hackathon. 90 days remaining. Covers Vertex AI, Compute Engine, BigQuery, everything.', faceValue: 200000, askingPrice: 80000, creditType: 'redemption code', proofLink: 'https://devpost.com/software/pennapps-gcp', contactInfo: 'email: apiflip@proton.me' },
    { userId: 'aaaaaaaa-0000-0000-0000-000000000002', type: 'selling', provider: 'Vercel', title: '$300 Vercel Pro credits', description: 'Vercel Pro plan credits from Next.js Conf hackathon. 6 months of Pro tier. Edge functions, analytics, the works.', faceValue: 30000, askingPrice: 12000, creditType: 'account login', proofLink: '', contactInfo: 'twitter: @api_flipper' },
    { userId: 'aaaaaaaa-0000-0000-0000-000000000003', type: 'selling', provider: 'AWS', title: '$5,000 AWS credits — re:Invent hackathon', description: 'Massive AWS credit pool from re:Invent 2025 hackathon winner prize. SageMaker, EC2, Lambda, S3 — full suite. 12 months validity.', faceValue: 500000, askingPrice: 200000, creditType: 'redemption code', proofLink: 'https://devpost.com/software/reinvent-winner', contactInfo: 'telegram: @cloud_dump' },
    { userId: 'aaaaaaaa-0000-0000-0000-000000000003', type: 'selling', provider: 'OpenAI', title: '$250 OpenAI credits — CalHacks', description: 'Standard OpenAI API credits. GPT-4o access. From CalHacks sponsor prize. ~3 months left on expiry.', faceValue: 25000, askingPrice: 10000, creditType: 'API key', proofLink: '', contactInfo: 'discord: clouddumper#4242' },
    { userId: 'aaaaaaaa-0000-0000-0000-000000000004', type: 'buying', provider: 'Anthropic', title: 'Looking for $1k+ Anthropic credits', description: 'Building an AI startup, need bulk Claude API access. Will pay 50-60% face value for large blocks. Prefer org invite method.', faceValue: null, askingPrice: 60000, creditType: 'org invite', proofLink: '', contactInfo: 'email: whale@startupmail.io' },
    { userId: 'aaaaaaaa-0000-0000-0000-000000000004', type: 'buying', provider: 'OpenAI', title: 'WTB: OpenAI credits any amount', description: 'Buying any OpenAI credits, any transfer method. Quick payment via crypto or venmo. Bulk preferred but will take small lots too.', faceValue: null, askingPrice: 50000, creditType: 'API key', proofLink: '', contactInfo: 'telegram: @creditwhale' },
    { userId: 'aaaaaaaa-0000-0000-0000-000000000005', type: 'selling', provider: 'Anthropic', title: '$750 Anthropic credits — HackGT', description: 'Won the Anthropic challenge at HackGT. Full Claude API access including Opus. Credits good through mid-2026.', faceValue: 75000, askingPrice: 35000, creditType: 'API key', proofLink: 'https://devpost.com/software/hackgt-anthropic', contactInfo: 'discord: nix#1337' },
    { userId: 'aaaaaaaa-0000-0000-0000-000000000005', type: 'buying', provider: 'Google Cloud', title: 'Need GCP credits for ML training', description: 'Training large models on Vertex AI. Need at least $2k in GCP credits. Will pay up to 45% face value.', faceValue: null, askingPrice: 90000, creditType: 'redemption code', proofLink: '', contactInfo: 'email: nixdev@pm.me' },
    { userId: 'aaaaaaaa-0000-0000-0000-000000000001', type: 'selling', provider: 'OpenAI', title: '$400 OpenAI — YC Startup School', description: 'OpenAI credits from YC Startup School batch. Full API access. Transfer via org invite, takes ~24h to process.', faceValue: 40000, askingPrice: 18000, creditType: 'org invite', proofLink: '', contactInfo: 'telegram: @hackerman_trades' },
    { userId: 'aaaaaaaa-0000-0000-0000-000000000004', type: 'selling', provider: 'AWS', title: '$3,000 AWS Activate credits', description: 'AWS Activate startup credits. 2 years validity. Covers basically all AWS services. Can transfer via linked account.', faceValue: 300000, askingPrice: 150000, creditType: 'account login', proofLink: '', contactInfo: 'email: whale@startupmail.io' },
  ];

  for (const l of seedListings) {
    await sql`
      INSERT INTO listings (user_id, type, provider, title, description, face_value, asking_price, credit_type, proof_link, contact_info, status)
      VALUES (${l.userId}, ${l.type}, ${l.provider}, ${l.title}, ${l.description}, ${l.faceValue}, ${l.askingPrice}, ${l.creditType}, ${l.proofLink}, ${l.contactInfo}, 'active')
    `;
  }

  const count = await sql`SELECT count(*) FROM listings`;
  console.log('Listings:', count[0].count);
  const userCount = await sql`SELECT count(*) FROM users`;
  console.log('Users:', userCount[0].count);

  await sql.end();
  console.log('Done');
}

main().catch(e => { console.error(e); process.exit(1); });
