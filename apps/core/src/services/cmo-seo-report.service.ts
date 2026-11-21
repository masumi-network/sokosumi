import {
  capabilitiesForClassification,
  cmoReportsSeo,
  cmoSeoReportBrief,
  getSokoBotVersion,
  type SokoBotCapability,
} from "@sokosumi/soko-bot";
import { isPrismaUniqueViolation } from "@/helpers/prisma";
import prisma from "@/lib/db/prisma";
import {
  type PresetRoute,
  presetClassificationResult,
} from "@/lib/soko-bot/classifier";
import type { Cuso } from "./cmo-cuso.service";
import { CMO_SEO_ROUTE } from "./cmo-seo.service";
import { latestCmoSeoAudit } from "./cmo-seo-audit.service";

export const CMO_SEO_REPORT_PREFIX = "cmo:seo-report:";

/** What the report reads and saves with; its one message is its reply. */
const REPORT_TOOLS: readonly SokoBotCapability[] = [
  "read_seo",
  "research_keywords",
  "save_seo_suggestions",
  "read_writing_skill",
  "web_fetch",
];
/** A card or a post of its own would be a second message for the same audit. */
const NOT_IN_REPORT: ReadonlySet<string> = new Set([
  "report_update",
  "post_chat",
  "check_search_rankings",
]);

/** The report's route: the SEO route with exactly the tools one message needs. */
export const CMO_SEO_REPORT_ROUTE: PresetRoute = {
  ...CMO_SEO_ROUTE,
  reason: "CMO weekly SEO report: one message after the weekly audit.",
  capabilities: [
    ...new Set([
      ...capabilitiesForClassification(
        presetClassificationResult("", CMO_SEO_ROUTE).classification,
      ),
      ...REPORT_TOOLS,
    ]),
  ].filter((capability) => !NOT_IN_REPORT.has(capability)),
};
/** An audit older than this when the Cuso first sees it gets no report (a Cuso moved onto cmo-v12 late). */
const REPORT_WINDOW_MS = 3 * 86_400_000;

/**
 * After a weekly audit is in, a cmo-v12 Cuso reports on SEO once: one turn
 * per audit (its id names the turn, unique per bot, so two syncs at once start
 * one), started by the CMO production sync, and that turn's reply is its only
 * message. A Cuso that is busy, paused or out of credits gets it on a later
 * sync; a turn that started never starts again, whatever became of it.
 */
export async function startCmoSeoReport(cuso: Cuso, now: Date): Promise<void> {
  const bot = await prisma.sokoBot.findUnique({
    where: { id: cuso.sokoBotId },
    select: { versionId: true },
  });
  if (!cmoReportsSeo(getSokoBotVersion(bot?.versionId).skills)) return;
  const audit = await latestCmoSeoAudit(cuso.projectId);
  if (!audit || now.getTime() - audit.observedAt.getTime() > REPORT_WINDOW_MS)
    return;
  const clientTurnId = `${CMO_SEO_REPORT_PREFIX}${audit.id}`;
  const exists = await prisma.sokoBotTurn.findFirst({
    where: { sokoBotId: cuso.sokoBotId, clientTurnId },
    select: { id: true },
  });
  if (exists) return;
  const { cmoRunnerUserId, startCmoTurn } = await import(
    "@/services/cmo-cuso.service"
  );
  const runnerId = await cmoRunnerUserId(cuso);
  if (!runnerId) return;
  try {
    await startCmoTurn(cuso, runnerId, {
      clientTurnId,
      message: cmoSeoReportBrief(
        cuso.businessName,
        audit.observedAt.toISOString().slice(0, 10),
      ),
      route: CMO_SEO_REPORT_ROUTE,
    });
  } catch (error) {
    if (isPrismaUniqueViolation(error)) return;
    throw error;
  }
}
