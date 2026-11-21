import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

export type SearchConsoleWarning =
  | "notConnected"
  | "reconnect"
  | "property"
  | "unavailable";

const warnings = new Map<string, SearchConsoleWarning>([
  [CORE_API_ERROR_KINDS.SEO_GSC_NOT_CONNECTED, "notConnected"],
  [CORE_API_ERROR_KINDS.SEO_GSC_RECONNECT, "reconnect"],
  [CORE_API_ERROR_KINDS.SEO_GSC_PROPERTY, "property"],
  [CORE_API_ERROR_KINDS.SEO_GSC_UNAVAILABLE, "unavailable"],
]);

export function seoSearchConsoleWarning(kind?: string) {
  return kind ? warnings.get(kind) : undefined;
}
