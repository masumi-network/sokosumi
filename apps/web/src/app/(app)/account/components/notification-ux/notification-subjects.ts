import type { NotificationPreference } from "@/lib/clients/generated/core";

type NotificationCategory = NotificationPreference["category"];

/**
 * One thing that can happen, and can be asked for on its own.
 *
 * This is the only list of settings a group has. An earlier round put a breadth
 * ladder above a row of per-subject switches and the two said the same thing in
 * two shapes: "Direct messages" appeared as a rung and again as a row. There is
 * one row per subject now, and nothing above it repeating it.
 *
 * A subject with no categories is drawn but not stored, the way email is drawn
 * as a channel nothing sends on yet.
 */
export interface SubjectSpec {
  id: string;
  label: string;
  hint: string;
  categories: readonly NotificationCategory[];
  /** In the "Important" preset. The part most accounts want and no more. */
  important: boolean;
  /**
   * Subjects this one already includes.
   *
   * Every message in a room carries the mentions in it, so the two cannot be
   * independent switches: asking for one and refusing the other describes
   * nothing a server could do. The narrower row stays visible and says it is
   * covered, and can still be set louder than its cover, which is the one
   * combination that does mean something.
   */
  covers: readonly string[];
}

export interface GroupSpec {
  label: string;
  subjects: readonly SubjectSpec[];
}

export const GROUP_SUBJECTS: Record<string, GroupSpec> = {
  TASK: {
    label: "Tasks",
    subjects: [
      {
        id: "TASK_WAITING",
        label: "Tasks that wait on you",
        hint: "A coworker asks for input, or hands work back.",
        categories: ["TASK"],
        important: true,
        covers: [],
      },
      {
        id: "TASK_OTHER",
        label: "Other task updates",
        hint: "Starts and finishes that need nothing from you.",
        categories: [],
        important: false,
        covers: [],
      },
    ],
  },
  CHAT: {
    label: "Chat",
    subjects: [
      {
        id: "CHAT_DIRECT",
        label: "Direct messages",
        hint: "Someone writes to you, and only to you.",
        categories: ["CHAT_DIRECT_MESSAGE"],
        important: true,
        covers: [],
      },
      {
        id: "CHAT_MENTIONS",
        label: "Mentions of you",
        hint: "Someone names you in a room you are in.",
        categories: ["CHAT_MENTION"],
        important: true,
        covers: [],
      },
      {
        id: "CHAT_THREADS",
        label: "Threads you follow",
        hint: "Replies under a thread you joined, named or not.",
        categories: [],
        important: false,
        covers: [],
      },
      {
        id: "CHAT_ROOMS",
        label: "Every message in your rooms",
        hint: "Everything written where you are.",
        categories: [],
        important: false,
        covers: ["CHAT_MENTIONS", "CHAT_THREADS"],
      },
    ],
  },
  JOB: {
    label: "Jobs",
    subjects: [
      {
        id: "JOB_NEEDS_YOU",
        label: "Runs that need you",
        hint: "A run fails, or stops and waits.",
        categories: ["JOB"],
        important: true,
        covers: [],
      },
      {
        id: "JOB_OTHER",
        label: "Other status changes",
        hint: "Queued, started, finished.",
        categories: [],
        important: false,
        covers: [],
      },
    ],
  },
  SYSTEM: {
    label: "Requests and access",
    subjects: [
      {
        id: "SYSTEM_ACCESS",
        label: "Requests and decisions about you",
        hint: "Someone asks for access, or a decision lands.",
        categories: ["SYSTEM"],
        important: true,
        covers: [],
      },
    ],
  },
};

export const GROUP_ORDER = ["TASK", "CHAT", "JOB", "SYSTEM"] as const;
