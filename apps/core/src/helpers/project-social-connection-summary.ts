import {
  isProjectSocialProvider,
  type ProjectSocialProvider,
} from "@/config/social-providers";
import { postsAsPerson } from "@/helpers/linkedin-person";

/** The stored row, as far as a summary reads it. */
interface StoredProjectSocialConnection {
  id: string;
  provider: string;
  externalAccountId: string;
  externalHandle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  subscriptionType: string | null;
  status: string;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
}

export interface ProjectSocialConnectionSummary {
  id: string;
  provider: ProjectSocialProvider;
  externalHandle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  subscriptionType: string | null;
  status: string;
  connectedAt: Date | null;
  disconnectedAt: Date | null;
  /** A LinkedIn connection that posts as the person, not as a company Page. */
  personalProfile: boolean;
}

/**
 * What any route says about a connected account, credential-free: the one
 * place that turns a stored row into the `ProjectSocialConnection` shape.
 * Null for a provider Core no longer offers.
 */
export function projectSocialConnectionSummary(
  connection: StoredProjectSocialConnection,
): ProjectSocialConnectionSummary | null {
  if (!isProjectSocialProvider(connection.provider)) return null;
  return {
    id: connection.id,
    provider: connection.provider,
    externalHandle: connection.externalHandle,
    displayName: connection.displayName,
    avatarUrl: connection.avatarUrl,
    subscriptionType: connection.subscriptionType,
    status: connection.status,
    connectedAt: connection.connectedAt,
    disconnectedAt: connection.disconnectedAt,
    personalProfile: postsAsPerson(
      connection.provider,
      connection.externalAccountId,
    ),
  };
}

/** The columns a post's account summary reads, for a Prisma select. */
export const socialPostConnectionSelect = {
  id: true,
  provider: true,
  externalAccountId: true,
  externalHandle: true,
  displayName: true,
  avatarUrl: true,
  subscriptionType: true,
  status: true,
} as const;

/** A post's account, credential-free: never its provider account id. */
export function socialPostConnectionSummary(
  connection:
    | {
        [Key in keyof typeof socialPostConnectionSelect]: Key extends
          | "externalHandle"
          | "displayName"
          | "avatarUrl"
          | "subscriptionType"
          ? string | null
          : string;
      }
    | null,
) {
  if (!connection) return null;
  const { externalAccountId, provider: _provider, ...summary } = connection;
  return {
    ...summary,
    personalProfile: postsAsPerson(connection.provider, externalAccountId),
  };
}
