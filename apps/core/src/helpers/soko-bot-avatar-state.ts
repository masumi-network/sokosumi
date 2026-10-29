import type { Prisma, SokoBotAvatarState } from "@sokosumi/database";

import {
  AVATAR_STATES,
  type AvatarState,
  LEGACY_AVATAR_STYLE_ID,
} from "@/lib/soko-bot-avatar/style";

/** The wire states are lowercase, the enum is not. */
export function toDbAvatarState(state: AvatarState): SokoBotAvatarState {
  return state.toUpperCase() as SokoBotAvatarState;
}

export function fromDbAvatarState(state: SokoBotAvatarState): AvatarState {
  return state.toLowerCase() as AvatarState;
}

/** How long "done" shows after a turn completes. */
export const DONE_AVATAR_STATE_MS = 10 * 60 * 1000;

/** Relation selects that feed {@link deriveAvatarState} and {@link buildAvatarView}. */
export const avatarStateRelations = () =>
  ({
    avatar: {
      select: {
        styleId: true,
        styleVersion: true,
        imageUrl: true,
        renders: {
          select: {
            state: true,
            stillUrl: true,
            loopUrl: true,
            loopLargeUrl: true,
          },
        },
      },
    },
    turns: {
      where: { parentTurnId: null },
      orderBy: { createdAt: "desc" },
      take: 1,
      select: { status: true, completedAt: true },
    },
    pendingDecisions: {
      where: { status: "PENDING", expiresAt: { gt: new Date() } },
      take: 1,
      select: { id: true },
    },
  }) satisfies Prisma.SokoBotSelect;

export interface AvatarStateInput {
  status: string;
  archivedAt: Date | null;
  adminPausedAt: Date | null;
  /** The latest foreground turn. */
  latestTurn: { status: string; completedAt: Date | null } | null;
  hasOpenDecision: boolean;
  /** Soko Bots switched off for everyone. Routes behind the kill-switch gate never see it. */
  availabilityDisabled?: boolean;
  now?: Date;
}

/**
 * The one rule every client shows. In priority order: offline, needs_you,
 * working, thinking, done (for ten minutes), idle. A failed or errored turn is
 * idle: the console's error UI already says so.
 */
export function deriveAvatarState(input: AvatarStateInput): AvatarState {
  if (
    input.availabilityDisabled ||
    input.archivedAt !== null ||
    input.adminPausedAt !== null ||
    input.status === "PAUSED"
  ) {
    return "offline";
  }
  if (input.hasOpenDecision) return "needs_you";
  const turn = input.latestTurn;
  if (turn?.status === "RUNNING" || turn?.status === "CANCEL_REQUESTED") {
    return "working";
  }
  if (turn?.status === "QUEUED" || turn?.status === "STARTING") {
    return "thinking";
  }
  if (
    turn?.status === "COMPLETED" &&
    turn.completedAt !== null &&
    (input.now ?? new Date()).getTime() - turn.completedAt.getTime() <=
      DONE_AVATAR_STATE_MS
  ) {
    return "done";
  }
  return "idle";
}

interface AvatarRowForView {
  styleId: string;
  styleVersion: number;
  imageUrl: string;
  renders: {
    state: string;
    stillUrl: string | null;
    loopUrl: string | null;
    loopLargeUrl: string | null;
  }[];
}

export interface AvatarStateAssets {
  stillUrl: string;
  loopUrl: string | null;
  loopLargeUrl: string | null;
}

export interface AvatarView {
  styleId: string;
  styleVersion: number;
  stillUrl: string;
  states: Record<AvatarState, AvatarStateAssets | null>;
}

/**
 * Where each still and loop lives. A legacy avatar has no renders: its one
 * image is the still and every state is null. A bot with no image at all has
 * no avatar view (the client draws the orb).
 */
export function buildAvatarView(
  avatar: AvatarRowForView | null,
  avatarImageUrl: string | null,
): AvatarView | null {
  const states = Object.fromEntries(
    AVATAR_STATES.map((state) => [state, null]),
  ) as AvatarView["states"];
  if (!avatar) {
    return avatarImageUrl
      ? {
          styleId: LEGACY_AVATAR_STYLE_ID,
          styleVersion: 1,
          stillUrl: avatarImageUrl,
          states,
        }
      : null;
  }
  for (const render of avatar.renders) {
    const state = fromDbAvatarState(render.state as SokoBotAvatarState);
    if (render.stillUrl) {
      states[state] = {
        stillUrl: render.stillUrl,
        loopUrl: render.loopUrl,
        loopLargeUrl: render.loopLargeUrl,
      };
    }
  }
  return {
    styleId: avatar.styleId,
    styleVersion: avatar.styleVersion,
    // The idle still is the look itself, whether or not its render row exists.
    stillUrl: avatar.imageUrl,
    states,
  };
}

/** `avatarState` and `avatar` for a bot loaded with {@link avatarStateRelations}. */
export function avatarFields(
  bot: Omit<AvatarStateInput, "latestTurn" | "hasOpenDecision"> & {
    avatarImageUrl: string | null;
    avatar: AvatarRowForView | null;
    turns: { status: string; completedAt: Date | null }[];
    pendingDecisions: unknown[];
  },
): { avatarState: AvatarState; avatar: AvatarView | null } {
  return {
    avatarState: deriveAvatarState({
      ...bot,
      latestTurn: bot.turns[0] ?? null,
      hasOpenDecision: bot.pendingDecisions.length > 0,
    }),
    avatar: buildAvatarView(bot.avatar, bot.avatarImageUrl),
  };
}
