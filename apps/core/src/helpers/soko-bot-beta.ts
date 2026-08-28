import type { Prisma } from "@sokosumi/database";

/**
 * While Soko Bot is in beta, only bots owned by a verified address on a
 * whitelisted domain may run. The router gate covers what a person can read;
 * this covers what the crons do on their own, which no request passes through.
 * Without it a bot created before the beta closed would keep ingesting mail,
 * firing schedules and spending its owner's credits invisibly.
 *
 * Kept as a Prisma filter rather than a per-bot call so a sync cannot forget
 * it after selecting: the bots simply are not returned.
 */
export const SOKO_BOT_BETA_OWNER_FILTER = {
  user: { is: { emailVerified: true, email: { endsWith: "@nmkr.io" } } },
} as const satisfies Prisma.SokoBotWhereInput;
