import type {
  ProjectSocialConnection,
  SocialPost,
} from "@sokosumi/core-client";

export interface SocialReconnection {
  connection: ProjectSocialConnection;
  affectedPosts: SocialPost[];
}

/** A reconnect supersedes authorization errors from the old credentials. */
export function getSocialReconnections(
  connections: ProjectSocialConnection[],
  posts: SocialPost[],
): SocialReconnection[] {
  return connections.flatMap((connection) => {
    if (connection.status === "disconnected" || connection.status === "pending")
      return [];
    const accountPosts = posts.filter(
      (post) => post.socialConnection?.id === connection.id,
    );
    const affectedPosts = accountPosts.filter(
      (post) =>
        post.status === "SCHEDULED" ||
        (post.status === "FAILED" &&
          (post.lastAttempt?.errorKind === "unauthorized" ||
            post.lastAttempt?.outcome === "authorization_revoked" ||
            post.lastError === "Social connection needs reconnecting")),
    );
    const broken =
      connection.status === "reauthorization_required" ||
      accountPosts.some((post) => {
        if (
          post.status !== "SCHEDULED" &&
          post.status !== "FAILED" &&
          post.status !== "MISSED"
        )
          return false;
        const failureAt = post.lastAttempt?.finishedAt ?? post.lastAttemptAt;
        if (
          connection.connectedAt &&
          failureAt &&
          new Date(connection.connectedAt) > new Date(failureAt)
        )
          return false;
        return (
          post.connectionNeedsReconnect ||
          post.lastAttempt?.errorKind === "unauthorized" ||
          post.lastAttempt?.outcome === "authorization_revoked" ||
          post.lastError === "Social connection needs reconnecting"
        );
      });
    return broken ? [{ connection, affectedPosts }] : [];
  });
}
