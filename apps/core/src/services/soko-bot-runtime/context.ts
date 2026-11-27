import {
  composeSystemPrompt,
  composeTurnPreamble,
  splitSkillsForTurn,
} from "@sokosumi/soko-bot";
import { loadSokoBotPersona } from "@/helpers/soko-bot-owner";
import prisma from "@/lib/db/prisma";
import { PRESET_VERSION } from "@/lib/soko-bot/classifier";
import { effectiveWorkRouteForPreload } from "@/lib/soko-bot/route-preload";
import { packetForModel } from "@/lib/soko-bot/turn-model-context";
import { ONBOARDING_TURN_PREFIX } from "@/services/cmo-cuso.service";
import { resolveSokoBotVersion } from "@/services/soko-bot-version.service";
import {
  type RuntimeAuthorizationInput,
  SokoBotRuntimeAuthorizationError,
} from "../soko-bot-runtime.service";
import { type RuntimeOperations } from "./operations";

/**
 * Whether a turn is a foreground human chat turn (typed by an owner or
 * teammate, not an autonomous schedule/event/ingest turn, background child,
 * preset turn, or bot-to-bot turn).
 */
export function isForegroundHumanChatTurn(
  turn: {
    source: string | null;
    chainDepth?: number | null;
    parentTurnId?: string | null;
    classifierVersion?: string | null;
  },
  askedByKind: string | null | undefined,
): boolean {
  return (
    turn.source === "CHAT" &&
    (turn.chainDepth ?? 0) === 0 &&
    !turn.parentTurnId &&
    askedByKind !== "ASSISTANT" &&
    turn.classifierVersion !== PRESET_VERSION
  );
}

function workRouteFromClassification(
  route: string | null,
  classification: unknown,
): string | null {
  const record =
    classification && typeof classification === "object"
      ? (classification as {
          unsureRoute?: unknown;
          rawRoute?: unknown;
          workConfidence?: unknown;
          classifierFailed?: unknown;
        })
      : {};
  return effectiveWorkRouteForPreload({ route, ...record });
}

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
 * Under `routeSteering` on foreground human chat turns, keeps route-based
 * skill preloading working (including work fallback when Jev abstained,
 * split votes, or failed) without emitting `CLARIFY` or `DIRECT_RESPONSE`.
 */
export function skillOccasions(
  turn: {
    clientTurnId: string | null;
    source: string;
    route: string | null;
    classification?: unknown;
  },
  packet: unknown,
  options?: { routeSteering?: boolean; foregroundHumanChat?: boolean },
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
  if (options?.routeSteering && options?.foregroundHumanChat) {
    const workRoute = workRouteFromClassification(
      turn.route,
      turn.classification,
    );
    return workRoute ? [workRoute] : [];
  }
  return [
    ...(turn.route ? [turn.route] : []),
    ...(turn.source === "INGEST" ? ["mail"] : []),
    ...(turn.source === "SCHEDULE" ? ["schedule"] : []),
  ];
}

export async function getContext(
  runtime: RuntimeOperations,
  input: RuntimeAuthorizationInput,
  options?: { includeDiagnostics?: boolean },
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
    select: {
      clientTurnId: true,
      source: true,
      route: true,
      parentTurnId: true,
      chainDepth: true,
      classifierVersion: true,
      classification: true,
    },
  });
  const foregroundHumanChat = turn
    ? isForegroundHumanChatTurn(turn, authorized.askedByKind)
    : false;
  const hideRoute =
    version.routeSteering === true &&
    foregroundHumanChat &&
    authorized.meetingPrep !== true;
  const occasions = turn
    ? skillOccasions(turn, snapshot.packet, {
        routeSteering: version.routeSteering === true,
        foregroundHumanChat,
      })
    : [];
  const promptTurn = { clientTurnId: turn?.clientTurnId ?? null, occasions };
  const visiblePacket = hideRoute
    ? packetForModel(snapshot.packet, { hideRoute: true })
    : snapshot.packet;
  return {
    ...snapshot,
    packet: visiblePacket,
    version: {
      id: version.id,
      name: version.name,
      model: version.model,
      systemPrompt: composeSystemPrompt(version, persona, promptTurn),
      skills: [...version.skills],
      ...(version.skillsOnDemand
        ? {
            turnPreamble: composeTurnPreamble(version, persona, promptTurn),
            ...(hideRoute ? {} : { skillOccasions: occasions }),
            preloadedSkills: splitSkillsForTurn(version, occasions).preloaded,
          }
        : {}),
    },
    ...(options?.includeDiagnostics
      ? {
          diagnostics: {
            hideRoute,
            skillOccasions: occasions,
          },
        }
      : {}),
  };
}
