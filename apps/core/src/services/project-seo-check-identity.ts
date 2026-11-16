import type { PublicSeoPayload } from "@/helpers/project-seo-report";
import { normalizeSeoUrl } from "./project-seo-store";

type Check = { pageUrl: string; rowId: string; device: string | null };

/** A measured rule remains tied to its Market, device and rulebook. */
export function checkIdentity(source: PublicSeoPayload, check: Check) {
  return JSON.stringify([
    normalizeSeoUrl(check.pageUrl),
    check.rowId,
    check.device,
    source.countryCode,
    source.languageCode,
    source.rulebookVersion,
  ]);
}

/** A later rulebook can report the same issue again without creating a duplicate issue. */
export function issueIdentity(source: PublicSeoPayload, check: Check) {
  return JSON.stringify([
    normalizeSeoUrl(check.pageUrl),
    check.rowId,
    check.device,
    source.countryCode,
    source.languageCode,
  ]);
}
