import type { ScenarioCheck } from "@sokosumi/soko-bot";
import { cmoHighlightsTools, getSokoBotVersion } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { cmoShortFormsFor } from "@/services/cmo-context-organizer";

/** cmo-v24's cases on the short save tools. */
export const CMO_SHORT_FORM_CASE_IDS: readonly string[] = [
  "cmo-short-form-brand-save",
  "cmo-thanks-reads-nothing",
];

/**
 * Whether the turn was offered the short save tools, called one, and saved
 * with the full tool after it. Nothing to check on a version before cmo-v24.
 */
export async function shortFormChecks(
  caseId: string,
  turnId: string,
): Promise<ScenarioCheck[]> {
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: { versionId: true },
  });
  if (!turn?.versionId) return [];
  if (!cmoHighlightsTools(getSokoBotVersion(turn.versionId).skills)) return [];
  const snapshot = await prisma.sokoBotContextSnapshot.findFirst({
    where: { turnId },
    select: { packet: true },
  });
  const organizer = (
    snapshot?.packet as {
      workspace?: { marketing?: { organizer?: unknown } | null };
    } | null
  )?.workspace?.marketing?.organizer;
  const offered = cmoShortFormsFor(organizer);
  const offeredCheck: ScenarioCheck = {
    label: "Offered the short save tools",
    pass: offered,
    actual: offered
      ? "short forms"
      : `full tools (${JSON.stringify({ kind: (organizer as { kind?: string })?.kind, change: (organizer as { change?: boolean })?.change })})`,
  };
  if (caseId !== "cmo-short-form-brand-save") return [offeredCheck];
  const events = await prisma.sokoBotRuntimeEvent.findMany({
    where: { turnId, type: "actions.requested" },
    orderBy: { startIndex: "asc" },
    select: { data: true },
  });
  const shortCalls = events.filter((event) =>
    (
      (event.data as { actions?: { name?: string; input?: unknown }[] })
        ?.actions ?? []
    ).some(
      (action) =>
        action.name === "save_brand_brain" &&
        (action.input as { shortForm?: unknown } | null)?.shortForm === true,
    ),
  ).length;
  const saved = await prisma.sokoBotToolCall.count({
    where: { turnId, capability: "save_brand_brain", status: "COMPLETED" },
  });
  return [
    offeredCheck,
    {
      label: "Called the short form, then saved with the full tool",
      pass: shortCalls > 0 && saved > 0,
      actual: `${shortCalls} short-form call${shortCalls === 1 ? "" : "s"}, ${saved} full save${saved === 1 ? "" : "s"}`,
    },
  ];
}
