import { deleteComposioToolSession, record } from "@/clients/composio.client";
import {
  isLinkedInOrganization,
  linkedInAuthorUrn,
  linkedInOrganizationId,
} from "@/clients/social-post-providers/linkedin-author";
import {
  type ComposioProxyParameter,
  ComposioToolError,
  createComposioToolSession,
  executeComposioProxy,
  executeComposioTool,
} from "@/clients/social-post-providers/tools";

const LINKEDIN_ORGANIZATION_ACLS_TOOL_SLUG = "LINKEDIN_GET_COMPANY_INFO";
const ACL_PAGE_SIZE = 100;
/** A member administering more pages than this sees the first ones only. */
const MAX_ORGANIZATIONS = 100;
const DETAIL_CONCURRENCY = 5;

/** LinkedIn REST is versioned by month; each version is served for a year. */
export const LINKEDIN_REST_VERSION = "202606";
export const LINKEDIN_REST_BASE_URL = "https://api.linkedin.com/rest";
export const LINKEDIN_REST_HEADERS: ComposioProxyParameter[] = [
  { name: "LinkedIn-Version", value: LINKEDIN_REST_VERSION, type: "header" },
  { name: "X-Restli-Protocol-Version", value: "2.0.0", type: "header" },
];

export interface LinkedInOrganization {
  /** `urn:li:organization:<id>`, stored as the page row's externalAccountId. */
  urn: string;
  name: string | null;
  vanityName: string | null;
  /** Provider CDN URL; expires, so callers copy it before storing. */
  logoUrl: string | null;
}

export type LinkedInOrganizationsResult =
  | { status: "ok"; organizations: LinkedInOrganization[] }
  /** The connection lacks the Community Management scopes. */
  | { status: "permission_missing"; organizations: [] };

interface LinkedInConnection {
  connectedAccountId: string;
  executorUserId: string;
  signal?: AbortSignal;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** LinkedIn answers a missing Community Management scope with 401/403 ACCESS_DENIED. */
function isPermissionMissing(error: unknown): boolean {
  if (!(error instanceof ComposioToolError)) return false;
  if (error.providerStatus === 401 || error.providerStatus === 403) return true;
  return /access[_ ]denied|not enough permissions|permission|scope|unauthori[sz]ed|forbidden/i.test(
    error.providerMessage ?? "",
  );
}

function organizationUrnOf(element: Record<string, unknown>): string | null {
  const urn =
    text(element.organization) ??
    text(element.organizationTarget) ??
    text(element.organizationalTarget);
  return urn && isLinkedInOrganization(urn) ? linkedInAuthorUrn(urn) : null;
}

/**
 * Organization URNs the connected member administers with an approved role,
 * from `organizationAcls?q=roleAssignee`, or `null` when the connection lacks
 * the scope to read them.
 */
export async function listLinkedInAdministeredOrganizationUrns(
  input: LinkedInConnection,
): Promise<string[] | null> {
  const sessionId = await createComposioToolSession({
    toolkitSlug: "linkedin",
    connectedAccountId: input.connectedAccountId,
    executorUserId: input.executorUserId,
    toolSlugs: [LINKEDIN_ORGANIZATION_ACLS_TOOL_SLUG],
    context: "create Project LinkedIn pages session",
    signal: input.signal,
  });
  try {
    const urns = new Set<string>();
    for (let start = 0; urns.size < MAX_ORGANIZATIONS; start += ACL_PAGE_SIZE) {
      let data: Record<string, unknown> | null;
      try {
        data = await executeComposioTool({
          sessionId,
          toolSlug: LINKEDIN_ORGANIZATION_ACLS_TOOL_SLUG,
          arguments: {
            role: "ADMINISTRATOR",
            state: "APPROVED",
            start,
            count: ACL_PAGE_SIZE,
          },
          context: "list LinkedIn administered pages",
          refused: "LinkedIn refused the page list",
          signal: input.signal,
        });
      } catch (error) {
        if (isPermissionMissing(error)) return null;
        throw error;
      }
      const elements = Array.isArray(data?.elements) ? data.elements : [];
      for (const element of elements) {
        const urn = organizationUrnOf(record(element) ?? {});
        if (urn && urns.size < MAX_ORGANIZATIONS) urns.add(urn);
      }
      const total = record(data?.paging)?.total;
      if (
        elements.length < ACL_PAGE_SIZE ||
        (typeof total === "number" && start + elements.length >= total)
      ) {
        break;
      }
    }
    return [...urns];
  } finally {
    await deleteComposioToolSession(
      sessionId,
      "delete Project LinkedIn pages session",
    );
  }
}

/** Download URL of an organization logo, or null when LinkedIn will not say. */
async function linkedInLogoUrl(
  input: LinkedInConnection,
  organization: Record<string, unknown>,
): Promise<string | null> {
  const logo = record(organization.logoV2);
  const asset = text(logo?.cropped) ?? text(logo?.original);
  const assetId = asset?.match(
    /^urn:li:(?:digitalmediaAsset|image):(.+)$/,
  )?.[1];
  if (!assetId) return null;
  const image = await executeComposioProxy({
    connectedAccountId: input.connectedAccountId,
    endpoint: `${LINKEDIN_REST_BASE_URL}/images/${encodeURIComponent(`urn:li:image:${assetId}`)}`,
    method: "GET",
    parameters: LINKEDIN_REST_HEADERS,
    context: "read LinkedIn page logo",
    signal: input.signal,
  });
  return image.status === 200 ? text(image.data?.downloadUrl) : null;
}

/**
 * Name, vanity name and logo of one page. Every field is best effort: a page
 * whose details cannot be read is still listed under its URN.
 */
export async function getLinkedInOrganization(
  input: LinkedInConnection & { urn: string },
): Promise<LinkedInOrganization> {
  const urn = linkedInAuthorUrn(input.urn);
  const fallback = { urn, name: null, vanityName: null, logoUrl: null };
  try {
    const response = await executeComposioProxy({
      connectedAccountId: input.connectedAccountId,
      endpoint: `${LINKEDIN_REST_BASE_URL}/organizations/${encodeURIComponent(linkedInOrganizationId(urn))}`,
      method: "GET",
      parameters: LINKEDIN_REST_HEADERS,
      context: "read LinkedIn page",
      signal: input.signal,
    });
    if (response.status !== 200 || !response.data) return fallback;
    const organization = response.data;
    const logoUrl = await linkedInLogoUrl(input, organization).catch(() => {
      input.signal?.throwIfAborted();
      return null;
    });
    return {
      urn,
      name: text(organization.localizedName),
      vanityName: text(organization.vanityName),
      logoUrl,
    };
  } catch {
    input.signal?.throwIfAborted();
    return fallback;
  }
}

/** Pages the connected member administers, with their names and logos. */
export async function listLinkedInAdministeredOrganizations(
  input: LinkedInConnection,
): Promise<LinkedInOrganizationsResult> {
  const urns = await listLinkedInAdministeredOrganizationUrns(input);
  if (!urns) return { status: "permission_missing", organizations: [] };
  const organizations: LinkedInOrganization[] = [];
  for (let index = 0; index < urns.length; index += DETAIL_CONCURRENCY) {
    organizations.push(
      ...(await Promise.all(
        urns
          .slice(index, index + DETAIL_CONCURRENCY)
          .map((urn) => getLinkedInOrganization({ ...input, urn })),
      )),
    );
  }
  return { status: "ok", organizations };
}
