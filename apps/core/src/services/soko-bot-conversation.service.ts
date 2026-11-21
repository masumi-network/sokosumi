import { sokoBotDisplayName } from "@/helpers/soko-bot-display-name";
import prisma from "@/lib/db/prisma";

/**
 * Who asked whom, each step, the model, the cost and the time: the turn the
 * owner started, every follow-up and background run of it, each message the
 * bot sent another agent or person, and what came back (with the model and
 * cost of the turn that wrote it, when another Soko Bot answered). Read from
 * the turns, their tool calls and the rooms; nothing is logged twice.
 */

/** Tools that put a message in front of someone else. */
const MESSAGING_TOOLS = [
  "send_message",
  "ask_coworker",
  "post_chat",
  "open_direct_chat",
];
const TEXT_CHARS = 1_200;
const REPLIES_PER_MESSAGE = 10;

export type ConversationStep =
  | {
      kind: "turn";
      at: string;
      turnId: string;
      title: string;
      status: string;
      model: string | null;
      /** Why the turn ran on its model (strong model for hard work, or the default). */
      modelReason: string | null;
      costUsd: number | null;
      durationMs: number | null;
      /** Its model calls, by role and the model that answered. */
      calls: ModelCallGroup[];
    }
  | {
      kind: "asked";
      at: string;
      by: string;
      to: string;
      room: string;
      text: string;
    }
  | {
      kind: "answered";
      at: string;
      by: string;
      byKind: "person" | "coworker" | "assistant";
      room: string;
      text: string;
      model: string | null;
      costUsd: number | null;
      durationMs: number | null;
    };

export interface ModelCallGroup {
  role: string;
  model: string;
  calls: number;
  costUsd: number;
}

/** A turn's model calls (upmodel's ledger), grouped by role and answering model. */
function groupCalls(
  calls: {
    role: string;
    requestedModel: string;
    answeredModel: string | null;
    costUsdMicros: bigint;
  }[],
): ModelCallGroup[] {
  const groups = new Map<string, ModelCallGroup>();
  for (const call of calls) {
    const model = call.answeredModel ?? call.requestedModel;
    const key = `${call.role} ${model}`;
    const group = groups.get(key) ?? {
      role: call.role,
      model,
      calls: 0,
      costUsd: 0,
    };
    group.calls += 1;
    group.costUsd += Number(call.costUsdMicros) / 1e6;
    groups.set(key, group);
  }
  return [...groups.values()];
}

export interface SokoBotConversation {
  turnId: string;
  steps: ConversationStep[];
  totals: { costUsd: number; durationMs: number; models: string[] };
}

function clip(text: string): string {
  const flat = text.trim();
  return flat.length > TEXT_CHARS ? `${flat.slice(0, TEXT_CHARS - 1)}…` : flat;
}

function usd(micros: bigint | null): number | null {
  return micros === null ? null : Number(micros) / 1e6;
}

function turnTitle(turn: {
  parentTurnId: string | null;
  backgroundTitle: string | null;
  userMessage: string;
}): string {
  if (!turn.parentTurnId) return clip(turn.userMessage).slice(0, 200);
  return turn.backgroundTitle ?? "Follow-up";
}

/** The conversation `turnId` belongs to, or null when there is none to show. */
export async function sokoBotConversation(
  turnId: string,
  access: { ownerUserId?: string } = {},
): Promise<SokoBotConversation | null> {
  const asked = await prisma.sokoBotTurn.findFirst({
    where: {
      id: turnId,
      ...(access.ownerUserId
        ? {
            requestedByUserId: access.ownerUserId,
            sokoBot: { userId: access.ownerUserId },
          }
        : {}),
    },
    select: { id: true, parentTurnId: true, sokoBotId: true },
  });
  if (!asked) return null;
  const originId = asked.parentTurnId ?? asked.id;
  const turns = await prisma.sokoBotTurn.findMany({
    where: {
      sokoBotId: asked.sokoBotId,
      OR: [{ id: originId }, { parentTurnId: originId }],
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      createdAt: true,
      parentTurnId: true,
      backgroundTitle: true,
      userMessage: true,
      status: true,
      modelId: true,
      modelReason: true,
      costUsdMicros: true,
      durationMs: true,
      modelCalls: {
        orderBy: { createdAt: "asc" },
        select: {
          role: true,
          requestedModel: true,
          answeredModel: true,
          costUsdMicros: true,
        },
      },
      sokoBot: { select: { id: true, name: true } },
      toolCalls: {
        where: {
          capability: { in: MESSAGING_TOOLS },
          status: "COMPLETED",
        },
        orderBy: { createdAt: "asc" },
        select: { capability: true, result: true, committedAt: true },
      },
    },
  });
  const steps: ConversationStep[] = [];
  for (const turn of turns) {
    steps.push({
      kind: "turn",
      at: turn.createdAt.toISOString(),
      turnId: turn.id,
      title: turnTitle(turn),
      status: turn.status,
      model: turn.modelId,
      modelReason: turn.modelReason,
      costUsd: usd(turn.costUsdMicros),
      durationMs: turn.durationMs,
      calls: groupCalls(turn.modelCalls),
    });
    for (const call of turn.toolCalls) {
      const result = call.result as {
        messageId?: unknown;
        roomId?: unknown;
        to?: unknown;
      } | null;
      if (typeof result?.messageId !== "string") continue;
      const message = await prisma.chatRoomMessage.findUnique({
        where: { id: result.messageId },
        select: {
          content: true,
          createdAt: true,
          roomId: true,
          room: {
            select: {
              name: true,
              groupName: true,
              coworkerMembers: {
                select: { coworker: { select: { name: true } } },
              },
              sokoBotMembers: {
                select: { sokoBot: { select: { id: true, name: true } } },
              },
              userMembers: { select: { user: { select: { name: true } } } },
            },
          },
        },
      });
      if (!message) continue;
      const room = message.room.groupName ?? message.room.name;
      const others = [
        ...message.room.coworkerMembers.map((member) => member.coworker.name),
        ...message.room.sokoBotMembers
          .filter((member) => member.sokoBot.id !== turn.sokoBot.id)
          .map((member) => sokoBotDisplayName({ name: member.sokoBot.name })),
      ];
      steps.push({
        kind: "asked",
        at: message.createdAt.toISOString(),
        by: sokoBotDisplayName({ name: turn.sokoBot.name }),
        to:
          typeof result.to === "string"
            ? result.to
            : others.join(", ") || `#${room}`,
        room,
        text: clip(message.content),
      });
      const next = await prisma.chatRoomMessage.findFirst({
        where: {
          roomId: message.roomId,
          senderSokoBotId: turn.sokoBot.id,
          createdAt: { gt: message.createdAt },
          deletedAt: null,
        },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      });
      const replies = await prisma.chatRoomMessage.findMany({
        where: {
          roomId: message.roomId,
          deletedAt: null,
          content: { not: "" },
          createdAt: {
            gt: message.createdAt,
            ...(next ? { lt: next.createdAt } : {}),
          },
          OR: [
            { senderSokoBotId: null },
            { senderSokoBotId: { not: turn.sokoBot.id } },
          ],
        },
        orderBy: { createdAt: "asc" },
        take: REPLIES_PER_MESSAGE,
        select: {
          id: true,
          content: true,
          createdAt: true,
          senderUser: { select: { name: true } },
          senderCoworker: { select: { name: true } },
          senderSokoBot: { select: { name: true } },
        },
      });
      for (const reply of replies) {
        // Another Soko Bot's answer is its turn's reply message: its model and cost.
        const answering = reply.senderSokoBot
          ? await prisma.sokoBotTurn.findFirst({
              where: { chatResponseMessageId: reply.id },
              select: { modelId: true, costUsdMicros: true, durationMs: true },
            })
          : null;
        steps.push({
          kind: "answered",
          at: reply.createdAt.toISOString(),
          by:
            reply.senderUser?.name ??
            reply.senderCoworker?.name ??
            sokoBotDisplayName({ name: reply.senderSokoBot?.name ?? null }),
          byKind: reply.senderUser
            ? "person"
            : reply.senderCoworker
              ? "coworker"
              : "assistant",
          room,
          text: clip(reply.content),
          model: answering?.modelId ?? null,
          costUsd: usd(answering?.costUsdMicros ?? null),
          durationMs: answering?.durationMs ?? null,
        });
      }
    }
  }
  steps.sort((left, right) => left.at.localeCompare(right.at));
  const priced = steps.filter((step) => step.kind !== "asked") as Exclude<
    ConversationStep,
    { kind: "asked" }
  >[];
  return {
    turnId: originId,
    steps,
    totals: {
      costUsd: priced.reduce((sum, step) => sum + (step.costUsd ?? 0), 0),
      durationMs: priced.reduce((sum, step) => sum + (step.durationMs ?? 0), 0),
      models: [
        ...new Set(priced.flatMap((step) => (step.model ? [step.model] : []))),
      ],
    },
  };
}
