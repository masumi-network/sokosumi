import type { Prisma } from "@sokosumi/database";

/**
 * While Soko Bot is in beta, only bots owned by a verified address on a
 * whitelisted domain may run. The router gate covers what a person can read;
 * this covers what the crons do on their own, which no request passes through.
 * Without it a bot created before the beta closed would keep ingesting mail,
 * firing schedules and spending its owner's credits invisibly.
 *
 * A function returning `SokoBotWhereInput` rather than an object to spread:
 * spreading into an object literal skips excess-property checking, so the same
 * filter went into three `task.findMany` calls unnoticed and Prisma threw at
 * run time on a `user` relation Task does not have. Passing this to any other
 * model's query is now a type error.
 */
export function withBetaBotOwner(
  where: Prisma.SokoBotWhereInput,
): Prisma.SokoBotWhereInput {
  return {
    ...where,
    user: {
      is: {
        emailVerified: true,
        // `isNmkrEmail` compares case-insensitively, so the cron filter must
        // too — otherwise A@NMKR.io reads the API but never runs.
        email: { endsWith: "@nmkr.io", mode: "insensitive" },
      },
    },
  };
}

/** The same rule for a query rooted elsewhere that filters through `sokoBot`. */
export function betaBotRelationFilter(
  where: Prisma.SokoBotWhereInput = {},
): Prisma.SokoBotWhereInput {
  return withBetaBotOwner(where);
}
