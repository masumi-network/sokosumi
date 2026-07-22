export const FIXTURE_PASSWORD = "Password123!";

export const FIXTURE_EMAILS = {
  admin: "admin@sokosumi.local",
  alice: "alice@sokosumi.local",
  bob: "bob@sokosumi.local",
  carol: "carol@sokosumi.local",
} as const;

export const FIXTURE_ORG_SLUGS = {
  acme: "acme",
  bootstrap: "bootstrap",
} as const;

export const FIXTURE_CATEGORY_SLUGS = {
  research: "research",
  engineering: "engineering",
} as const;

export const FIXTURE_AGENT_BLOCKCHAIN_IDS = {
  freeAgent: "seed-agent-free-001",
  fixedAgent: "seed-agent-fixed-002",
  fixedAgentTwo: "seed-agent-fixed-003",
} as const;

export const FIXTURE_VENDOR_SLUG = "serviceplan";

export const SEED_COWORKER_SLUGS = ["elena", "alex", "hannah", "nori"] as const;

export const SEED_SUBSCRIPTION_IDS = {
  alicePro: "seed_sub_alice_pro",
  acmeStarter: "seed_sub_acme_starter",
} as const;

export const SEED_TASK_NAMES = {
  draft: "Seed: Draft competitive brief",
  ready: "Seed: Ready market landscape",
  completed: "Seed: Completed weekly status",
} as const;

export const SEED_JOB_AGENT_IDS = {
  completed: "seed-job-completed-001",
  running: "seed-job-running-002",
} as const;
