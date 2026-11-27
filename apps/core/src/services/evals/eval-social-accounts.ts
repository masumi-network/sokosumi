import prisma from "@/lib/db/prisma";
import { EVAL_CONNECTED_ACCOUNT_PREFIX } from "@/lib/evals/eval-social-account";

/** Every network a bot can post to, and a LinkedIn Page beside the person. */
export const EVAL_SOCIAL_NETWORKS = [
  "x",
  "linkedin",
  "linkedin-page",
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
] as const;
export type EvalSocialNetwork = (typeof EVAL_SOCIAL_NETWORKS)[number];

/**
 * A stand-in account on one network, connected as an owner's would be. No
 * network account is behind it: drafts, schedules, publishes, statistics and
 * comments on it get the fixed answers in eval-social-account.
 */
export async function connectEvalSocialAccount(input: {
  projectId: string;
  connectorUserId: string;
  network: EvalSocialNetwork;
  /** Unique per lane and account, e.g. `eval-3-cuso-x`. */
  key: string;
  handle?: string;
  displayName?: string;
}): Promise<string> {
  const page = input.network === "linkedin-page";
  const { id } = await prisma.projectSocialConnection.create({
    data: {
      projectId: input.projectId,
      provider: page ? "linkedin" : input.network,
      externalAccountId: page ? `urn:li:organization:${input.key}` : input.key,
      externalHandle: input.handle ?? "evalbrand",
      displayName: input.displayName ?? "Eval brand",
      composioConnectedAccountId: `${EVAL_CONNECTED_ACCOUNT_PREFIX}${input.key}`,
      status: "active",
      activeExternalAccountKey: input.key,
      connectorUserId: input.connectorUserId,
      connectedAt: new Date(),
    },
    select: { id: true },
  });
  return id;
}
