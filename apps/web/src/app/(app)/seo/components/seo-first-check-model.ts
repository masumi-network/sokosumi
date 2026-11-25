import type {
  ProjectSeoWorkspace,
  RequestProjectSeoAnalysisRequest,
} from "@sokosumi/core-client";
import { seoDefaultMarket } from "./seo-analysis-market-model";
import { analysisSeoBody } from "./seo-form-model";

/**
 * The free HTML page check a new audit starts on its own, so the first result needs no further step.
 * Null when the workspace cannot start one: the setup card then offers the check.
 */
export function seoFirstPageCheckBody(
  workspace: ProjectSeoWorkspace,
  idempotencyKey: string,
): RequestProjectSeoAnalysisRequest | null {
  const form = new FormData();
  const market = seoDefaultMarket(workspace);
  form.set("kind", "page_check");
  form.set("countryCode", market.countryCode);
  form.set("languageCode", market.languageCode);
  form.append("devices", "mobile");
  form.append("devices", "desktop");
  try {
    return { ...analysisSeoBody(form, workspace), idempotencyKey };
  } catch {
    return null;
  }
}
