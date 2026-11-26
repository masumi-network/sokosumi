import { serializableTransaction } from "@/lib/db/transaction";
import type { AuthenticationContext } from "@/middleware/auth";
import type { SeoTaskActionImpact } from "@/schemas/seo-action-impact.schema";
import { getProjectSeoWorkspace } from "./project-seo.service";
import {
  requireConnectedSearchConsole,
  requireSeoTaskSearchConsoleContext,
} from "./seo-task-search-console-context";

/**
 * The before and after of the owner's done actions, for the configured SEO
 * worker of an audit Task. It stands behind the same approval as the worker's
 * Search Console reads, and it names only actions on the audit's own pages.
 * Stored rows only: this spends no Search Console read.
 */
export async function readSeoTaskActionImpact(
  auth: AuthenticationContext,
  taskId: string,
  days?: number,
): Promise<SeoTaskActionImpact> {
  const context = await serializableTransaction(async (tx) => {
    const current = await requireSeoTaskSearchConsoleContext(
      auth,
      taskId,
      null,
      tx,
    );
    requireConnectedSearchConsole(current);
    return current;
  }, "The audit or Google connection changed. Please retry.");
  const { actions } = await getProjectSeoWorkspace(
    context.actor,
    {},
    { actionImpact: { days } },
  );
  const pages = new Set(context.pageUrls);
  return {
    actions: actions.flatMap(({ id, pageUrl, title, impact }) =>
      impact && pages.has(pageUrl) ? [{ id, pageUrl, title, impact }] : [],
    ),
  };
}
