import type { NotificationPreference } from "@/lib/clients/generated/core";

type NotificationCategory = NotificationPreference["category"];

/**
 * One rung of a group's breadth ladder.
 *
 * The rungs are ordered narrow to broad and they contain each other: picking a
 * rung means every rung below it as well. That is the whole point. "Every
 * message in your channels" already carries the mentions, so offering the two
 * as independent switches would let a reader ask for a state that cannot exist.
 *
 * A rung with no categories is drawn but not stored. It is here so the ladder
 * can be judged at the length it will really have, the way email is drawn as a
 * channel nothing sends on yet.
 */
export interface ScopeRung {
  id: string;
  /** What this rung adds, on its own. */
  label: string;
  hint: string;
  /** What the whole selection reads as when this rung is the top one. */
  summary: string;
  categories: readonly NotificationCategory[];
}

export interface GroupScopes {
  rungs: readonly ScopeRung[];
  /** The rung a new account starts on, and the one "Important" means. */
  defaultIndex: number;
}

/**
 * The ladders, per group.
 *
 * Chat is the one with real depth, and the reason this exists: direct messages,
 * then mentions, then threads, then everything. The others are shorter, which
 * is the point of a catalogue rather than a special case for chat: a group with
 * one rung shows no breadth control at all, and grows one by gaining a row
 * here.
 */
export const GROUP_SCOPES: Record<string, GroupScopes> = {
  TASK: {
    defaultIndex: 0,
    rungs: [
      {
        id: "WAITING",
        label: "Tasks that wait on you",
        hint: "A coworker asks for input, or hands work back.",
        summary: "Tasks that wait on you",
        categories: ["TASK"],
      },
      {
        id: "ALL_TASKS",
        label: "Every task update",
        hint: "Starts, finishes and failures, not only the ones that need you.",
        summary: "Every task update",
        categories: [],
      },
    ],
  },
  CHAT: {
    defaultIndex: 1,
    rungs: [
      {
        id: "DIRECT",
        label: "Direct messages",
        hint: "Someone writes to you, and only to you.",
        summary: "Direct messages",
        categories: ["CHAT_DIRECT_MESSAGE"],
      },
      {
        id: "MENTIONS",
        label: "Mentions of you",
        hint: "Someone names you in a room you are in.",
        summary: "Direct messages and mentions",
        categories: ["CHAT_MENTION"],
      },
      {
        id: "THREADS",
        label: "Threads you follow",
        hint: "Replies under a thread you joined, whether or not you are named.",
        summary: "Direct messages, mentions, and threads you follow",
        categories: [],
      },
      {
        id: "CHANNELS",
        label: "Every message in your rooms",
        hint: "Everything written where you are, mentions included.",
        summary: "Every message in your rooms",
        categories: [],
      },
    ],
  },
  JOB: {
    defaultIndex: 0,
    rungs: [
      {
        id: "FAILURES",
        label: "Runs that need you",
        hint: "A run fails, or stops and waits.",
        summary: "Runs that need you",
        categories: ["JOB"],
      },
      {
        id: "ALL_RUNS",
        label: "Every status change",
        hint: "Queued, started and finished as well.",
        summary: "Every run status change",
        categories: [],
      },
    ],
  },
  SYSTEM: {
    defaultIndex: 0,
    rungs: [
      {
        id: "MINE",
        label: "Requests and decisions about you",
        hint: "Someone asks for access, or a decision lands.",
        summary: "Requests and access decisions",
        categories: ["SYSTEM"],
      },
    ],
  },
};
