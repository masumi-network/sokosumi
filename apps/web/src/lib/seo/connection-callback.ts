import { z } from "zod";
import type { ActionError } from "@/lib/actions/errors/action-error";

export const SEO_CONNECTION_CALLBACK_PATH = "/seo/connections/callback";
export const SEO_CONNECTION_RETURN_PATH = "/seo/connections/return";
export const SEO_CONNECTION_HANDOFF_PREFIX = "sokosumi:seo:callback:";
const providerSchema = z.enum(["ga4", "search_console"]);
export type SeoConnectionCallbackContext = {
  provider: "ga4" | "search_console";
  viewerId: string;
  organizationId: string | null;
  nonce: string | null;
  sessionUri: string | null;
  connectionId: string | null;
  returnPath: string;
  failed: boolean;
};

/** Only an Audit, or a Project's own SEO workspace, can select the local return page. */
export function seoConnectionReturnPath(params: URLSearchParams) {
  const audit = z.uuid().safeParse(params.get("auditId"));
  if (audit.success) return `/seo?auditId=${audit.data}`;
  const project = z.uuid().safeParse(params.get("projectId"));
  return project.success && params.get("view") === "project"
    ? `/seo?projectId=${project.data}&view=project`
    : "/seo";
}

export function seoConnectionCallbackUrl(input: {
  origin: string;
  search: string;
  provider: "ga4" | "search_console";
  viewerId: string;
  organizationId: string | null;
  nonce: string;
}) {
  const url = new URL(SEO_CONNECTION_CALLBACK_PATH, input.origin);
  url.searchParams.set("provider", input.provider);
  url.searchParams.set("viewer", input.viewerId);
  url.searchParams.set("organization", input.organizationId ?? "");
  url.searchParams.set("seo_state", input.nonce);
  const auditId = new URLSearchParams(input.search).get("auditId");
  if (auditId && z.uuid().safeParse(auditId).success)
    url.searchParams.set("auditId", auditId);
  return url.toString();
}

export function readSeoConnectionCallback(
  params: URLSearchParams,
): SeoConnectionCallbackContext | null {
  const provider = providerSchema.safeParse(params.get("provider"));
  const viewer = z.string().min(1).max(200).safeParse(params.get("viewer"));
  if (!provider.success || !viewer.success) return null;
  const status = params.get("status")?.toLowerCase();
  return {
    provider: provider.data,
    viewerId: viewer.data,
    organizationId: params.get("organization") || null,
    nonce: params.get("seo_state"),
    sessionUri: params.get("session_uri") ?? params.get("sessionUri"),
    connectionId:
      params.get("connected_account_id") ??
      params.get("connectedAccountId") ??
      params.get("connectionId"),
    returnPath: seoConnectionReturnPath(params),
    failed:
      ["failed", "error", "expired", "inactive"].includes(status ?? "") ||
      params.has("error"),
  };
}

/** Browser handoff data is untrusted. It never grants access or chooses a host. */
export function readSeoConnectionHandoff(
  value: string,
): SeoConnectionCallbackContext | null {
  if (!value.startsWith(SEO_CONNECTION_HANDOFF_PREFIX)) return null;
  try {
    const parsed = z
      .object({
        provider: providerSchema,
        viewerId: z.string().min(1).max(200),
        organizationId: z.string().max(200).nullable(),
        nonce: z.string().max(200).nullable(),
        sessionUri: z.string().max(8_192).nullable(),
        connectionId: z.string().max(200).nullable(),
        returnPath: z.string().max(500),
        failed: z.boolean(),
      })
      .safeParse(JSON.parse(value.slice(SEO_CONNECTION_HANDOFF_PREFIX.length)));
    if (!parsed.success) return null;
    const path = new URL(parsed.data.returnPath, "https://seo.invalid");
    return {
      ...parsed.data,
      returnPath:
        path.origin === "https://seo.invalid" && path.pathname === "/seo"
          ? seoConnectionReturnPath(path.searchParams)
          : "/seo",
    };
  } catch {
    return null;
  }
}

/** Fixed product copy, never raw provider errors or callback credentials. */
export function seoConnectionErrorKey(error: ActionError | null) {
  if (error?.kind === "seo_viewer_changed") return "viewerChanged";
  if (error?.kind === "integration_not_configured") return "unavailable";
  if (error?.status === 401 || error?.code === "UNAUTHENTICATED")
    return "signInRequired";
  if (error?.status === 403) return "accessDenied";
  if (error?.status === 404) return "expired";
  if (error?.status === 409) return "activationPending";
  if (error?.status === 422) return "consentFailed";
  if (error?.status === 503) return "temporarilyUnavailable";
  return "connectFailed";
}
