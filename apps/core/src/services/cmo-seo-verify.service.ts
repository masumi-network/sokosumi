import { isPrismaRecordNotFoundError } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import type { Cuso } from "@/services/cmo-cuso.service";
import { normalizeSeoUrl } from "@/services/project-seo-store";
import { updateSeoSuggestion } from "@/services/seo-impact-record";
import { latestCmoSeoAudit, pageCarriesText } from "./cmo-seo-audit.service";

/** Whether the page now carries the new text (its title, description or heading included). */
async function pageShowsText(pageUrl: string, text: string): Promise<boolean> {
  return (await pageCarriesText(pageUrl, text)) === true;
}

/**
 * After each weekly audit, the page changes the owner marked done are
 * checked: an audit's own finding counts as fixed once the audit ran its
 * check on the page and it passed (a check it could not run confirms
 * nothing); a change Cuso wrote counts once its new text is on the page.
 */
export async function verifyCmoSeoChanges(cuso: Cuso): Promise<void> {
  const latest = await latestCmoSeoAudit(cuso.projectId);
  if (!latest) return;
  const done = await prisma.projectSeoSuggestion.findMany({
    where: {
      projectId: cuso.projectId,
      kind: "page_change",
      status: "done",
      doneAt: { lt: latest.observedAt },
      OR: [{ checkedAt: null }, { checkedAt: { lt: latest.observedAt } }],
    },
  });
  const firing = new Set(
    latest.payload.findings.map(
      (finding) => `${finding.rowId}|${normalizeSeoUrl(finding.pageUrl)}`,
    ),
  );
  const passed = new Set<string>();
  for (const check of latest.payload.checks) {
    const key = `${check.rowId}|${normalizeSeoUrl(check.pageUrl)}`;
    if (check.result === "pass") passed.add(key);
    else if (check.result === "fired") firing.add(key);
  }
  for (const suggestion of done) {
    let fixed = false;
    try {
      if (suggestion.source === "audit") {
        const rowIds = auditRowIds(suggestion.key);
        fixed =
          !!suggestion.pageUrl &&
          rowIds.length > 0 &&
          rowIds.every((rowId) => {
            const key = `${rowId}|${normalizeSeoUrl(suggestion.pageUrl!)}`;
            return passed.has(key) && !firing.has(key);
          });
      } else if (suggestion.pageUrl && suggestion.newText) {
        fixed = await pageShowsText(suggestion.pageUrl, suggestion.newText);
      }
    } catch (error) {
      recordCoreWarning(
        { operation: "cmo_seo_verify", sokoBot: { id: cuso.sokoBotId } },
        {
          message: "Checking a done page change failed",
          why: "The page could not be read",
          fix: "The next weekly audit checks it again.",
        },
        { failure: messageSafeErrorFields(error) },
      );
    }
    await updateSeoSuggestion({
      // Only the change it checked: an owner who reopened or redid it since
      // keeps that write, and the next audit checks the new one. A newer
      // audit's check that ran meanwhile stands.
      where: {
        id: suggestion.id,
        status: "done",
        doneAt: suggestion.doneAt,
        OR: [{ checkedAt: null }, { checkedAt: { lt: latest.observedAt } }],
      },
      data: {
        checkedAt: latest.observedAt,
        ...(fixed ? { status: "verified", verifiedAt: latest.observedAt } : {}),
      },
    }).catch((error: unknown) => {
      if (!isPrismaRecordNotFoundError(error)) throw error;
    });
  }
}

function auditRowIds(key: string): string[] {
  const rows = key.slice(key.lastIndexOf(":") + 1);
  return rows ? rows.split(",") : [];
}
