import {
  type SocialPostProvider,
  socialPostTextLength,
  socialPostTextLimit,
} from "@sokosumi/utils";

/** Shared caption until the reader edits one account on its own. */

export interface SocialPostComposerText {
  shared: string;
  byConnectionId: Record<string, string>;
  lastSharedEditId: string | null;
}

export function socialPostTextFor(
  connectionId: string | null | undefined,
  copy: Pick<SocialPostComposerText, "shared" | "byConnectionId">,
): string {
  if (connectionId && Object.hasOwn(copy.byConnectionId, connectionId)) {
    return copy.byConnectionId[connectionId];
  }
  return copy.shared;
}

export function socialPostTextWrite(
  connectionId: string | undefined,
  next: string,
  copy: SocialPostComposerText,
  perAccount: boolean,
): SocialPostComposerText {
  const forked =
    connectionId !== undefined &&
    Object.hasOwn(copy.byConnectionId, connectionId);
  if (
    perAccount &&
    connectionId &&
    (forked ||
      (copy.lastSharedEditId !== null &&
        copy.lastSharedEditId !== connectionId))
  ) {
    return {
      shared: copy.shared,
      byConnectionId: { ...copy.byConnectionId, [connectionId]: next },
      lastSharedEditId: copy.lastSharedEditId,
    };
  }
  const byConnectionId = { ...copy.byConnectionId };
  if (connectionId && forked) {
    delete byConnectionId[connectionId];
  }
  return {
    shared: next,
    byConnectionId,
    lastSharedEditId:
      perAccount && connectionId ? connectionId : copy.lastSharedEditId,
  };
}

/** One counter and validation path for the main post and every thread part. */
export function socialPostTextMetrics(
  text: string,
  provider: SocialPostProvider,
  subscriptionType?: string | null,
) {
  const count = socialPostTextLength(provider, text);
  const limit = socialPostTextLimit(provider, subscriptionType);
  return { count, limit, overLimit: count > limit };
}
