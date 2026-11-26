import {
  composeSystemPrompt,
  composeTurnPreamble,
  splitSkillsForTurn,
} from "@sokosumi/soko-bot";
import { loadSokoBotPersona } from "@/helpers/soko-bot-owner";
import prisma from "@/lib/db/prisma";
import { ONBOARDING_TURN_PREFIX } from "@/services/cmo-cuso.service";
import { resolveSokoBotVersion } from "@/services/soko-bot-version.service";
import {
  type RuntimeAuthorizationInput,
  SokoBotRuntimeAuthorizationError,
} from "../soko-bot-runtime.service";
import { type RuntimeOperations } from "./operations";

/** Owner-installed skills, advertised by Eve as load-on-demand skills. */
export async function getInstalledSkills(
  runtime: RuntimeOperations,
  input: RuntimeAuthorizationInput,
) {
  const authorized = await runtime.authorize(input);
  const skills = await prisma.sokoBotInstalledSkill.findMany({
    where: { sokoBotId: authorized.turn.sokoBotId },
    orderBy: { createdAt: "asc" },
    select: { name: true, description: true, markdown: true },
  });
  return { skills };
}

/**
 * What a turn is, for the skills it preloads: a Cuso turn's kind from the
 * context organizer, a Soko Bot turn's route and where it came from.
 */
export function skillOccasions(
  turn: {
    clientTurnId: string | null;
    source: string;
    route: string | null;
  },
  packet: unknown,
): string[] {
  const kind = (
    packet as {
      workspace?: { marketing?: { organizer?: { kind?: string } } | null };
    } | null
  )?.workspace?.marketing?.organizer?.kind;
  if (kind)
    return turn.clientTurnId?.startsWith(ONBOARDING_TURN_PREFIX)
      ? [kind, "onboarding"]
      : [kind];
  return [
    ...(turn.route ? [turn.route] : []),
    ...(turn.source === "INGEST" ? ["mail"] : []),
    ...(turn.source === "SCHEDULE" ? ["schedule"] : []),
  ];
}

export async function getContext(
  runtime: RuntimeOperations,
  input: RuntimeAuthorizationInput,
) {
  const authorized = await runtime.authorize(input);
  const snapshot = await prisma.sokoBotContextSnapshot.findFirst({
    where: {
      id: authorized.grant.contextSnapshotId,
      turnId: authorized.turn.id,
    },
    select: {
      packet: true,
      hash: true,
      schemaVersion: true,
      generatedAt: true,
    },
  });
  if (!snapshot) {
    throw new SokoBotRuntimeAuthorizationError(
      "Context snapshot is unavailable",
    );
  }
  const version = await resolveSokoBotVersion(authorized.turn.versionId);
  const persona = await loadSokoBotPersona(authorized.turn.sokoBotId);
  // A cmo-v20 production run leaves out the skills it never uses; a version
  // that loads skills on demand preloads those its kind of turn needs.
  const turn = await prisma.sokoBotTurn.findUnique({
    where: { id: authorized.turn.id },
    select: { clientTurnId: true, source: true, route: true },
  });
  const occasions = turn ? skillOccasions(turn, snapshot.packet) : [];
  const promptTurn = { clientTurnId: turn?.clientTurnId ?? null, occasions };
  return {
    ...snapshot,
    version: {
      id: version.id,
      name: version.name,
      model: version.model,
      systemPrompt: composeSystemPrompt(version, persona, promptTurn),
      skills: [...version.skills],
      ...(version.skillsOnDemand
        ? {
            turnPreamble: composeTurnPreamble(version, persona, promptTurn),
            skillOccasions: occasions,
            preloadedSkills: splitSkillsForTurn(version, occasions).preloaded,
          }
        : {}),
    },
  };
}
