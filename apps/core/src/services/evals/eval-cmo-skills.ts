import type { ScenarioCheck } from "@sokosumi/soko-bot";
import { getSokoBotVersion } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { SKILLS_PRELOADED_EVENT } from "@/lib/soko-bot/turn-loop";

/** The skill each case needs: carried in full from the start, or read. */
const NEEDED: Readonly<
  Record<string, { skill: string; how: "preloaded" | "read" }>
> = {
  "cmo-daily-run-watch": { skill: "cmo-daily-watch", how: "preloaded" },
  "cmo-weekly-review-last-week": { skill: "cmo-measurement", how: "preloaded" },
  "cmo-chat-strategy-skill": { skill: "cmo-strategy-v22", how: "read" },
};

export const CMO_SKILL_CASE_IDS: readonly string[] = Object.keys(NEEDED);

/**
 * Whether a version with a skill index (cmo-v24) had the skill the case
 * needs: preloaded by the kind of turn, or read with read_skill. Nothing to
 * check on a version that carries every skill.
 */
export async function skillChecks(
  caseId: string,
  turnId: string,
): Promise<ScenarioCheck[]> {
  const needed = NEEDED[caseId];
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: turnId },
    select: { versionId: true },
  });
  if (!needed || !turn?.versionId) return [];
  if (!getSokoBotVersion(turn.versionId).skillsOnDemand) return [];
  if (needed.how === "preloaded") {
    const events = await prisma.sokoBotRuntimeEvent.findMany({
      where: { turnId, type: SKILLS_PRELOADED_EVENT },
      select: { data: true },
    });
    const preloaded = events.flatMap(
      (event) => (event.data as { preloaded?: string[] })?.preloaded ?? [],
    );
    return [
      {
        label: `Carried ${needed.skill} from the start`,
        pass: preloaded.includes(needed.skill),
        actual: [...new Set(preloaded)].join(", ") || "nothing preloaded",
      },
    ];
  }
  const reads = await prisma.sokoBotToolCall.findMany({
    where: { turnId, capability: "read_skill", status: "COMPLETED" },
    select: { input: true },
  });
  const read = reads.map(
    (call) => (call.input as { skill?: string } | null)?.skill ?? "?",
  );
  return [
    {
      label: `Read ${needed.skill} before answering`,
      pass: read.includes(needed.skill),
      actual: read.join(", ") || "no read_skill",
    },
  ];
}
