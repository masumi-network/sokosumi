/**
 * The eval world's social accounts. Eval lanes seed stand-in connections
 * whose Composio account id starts with this prefix; no network account is
 * behind them. Provider adapters answer for them with fixed results, and
 * the network clients refuse any request that names one, so an eval lane
 * can connect, draft, schedule, publish and read statistics without a
 * single real call.
 */
export const EVAL_CONNECTED_ACCOUNT_PREFIX = "eval:";

/** An eval lane's organization: `sokosumi-evals-<lane>` (eval-lanes.service). */
export const EVAL_ORGANIZATION_SLUG = /^sokosumi-evals-\d+$/;

export function isEvalSocialAccount(connectedAccountId: string): boolean {
  return connectedAccountId.startsWith(EVAL_CONNECTED_ACCOUNT_PREFIX);
}

/** A stand-in account reached a network client: a bug in a stub, never sent. */
export class EvalExternalCallError extends Error {
  constructor(where: string) {
    super(`An eval stand-in account reached ${where}; nothing was sent.`);
    this.name = "EvalExternalCallError";
  }
}

/** Throws before any network request that names a stand-in account. */
export function refuseEvalSocialAccount(
  where: string,
  ...connectedAccountIds: readonly (string | null | undefined)[]
): void {
  if (connectedAccountIds.some((id) => id && isEvalSocialAccount(id)))
    throw new EvalExternalCallError(where);
}

/** Throws when a request path or query names a stand-in account. */
export function refuseEvalSocialAccountInPath(where: string, path: string) {
  const parts = path.split(/[/?&=]/).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  refuseEvalSocialAccount(where, ...parts);
}

/** What a stand-in network reports for every post: the same each run. */
export const EVAL_POST_METRICS = {
  views: 1200,
  impressions: 1500,
  likes: 34,
  comments: 3,
  shares: 5,
  saves: 2,
} as const;

/** What a stand-in network reports for the account itself. */
export const EVAL_ACCOUNT_FOLLOWERS = 850;

/** The id a stand-in network gives a post or reply, stable for its input. */
export function evalExternalId(kind: string, key: string): string {
  return `eval-${kind}-${key}`;
}
