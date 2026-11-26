import type {
  SokoBotContextPacket,
  TurnClassification,
} from "@sokosumi/soko-bot";

type Packet = Omit<SokoBotContextPacket, "hash">;

/**
 * A Soko Bot's small packet (v38, ADR 0086): what a turn always sees, what
 * its kind adds, and a map of the rest. The kind comes from Core's own ids,
 * never from the message; a typed message adds what the classifier's signals
 * (Jev) say it is about, so the pick costs no extra model call.
 */

export type SokoBotPacketKind =
  | "chat"
  | "event"
  | "schedule"
  | "rhythm"
  | "dreaming"
  | "memory"
  | "meeting-prep"
  | "ingest";

/** How many of each collection a turn's packet shows. */
export interface SokoBotPacketPlan {
  kind: SokoBotPacketKind;
  /** The board beyond what waits on the owner and the Tasks a turn names. */
  tasks: number;
  /** Tasks that wait on the owner: always shown, the rest counted in map. */
  waitingTasks: number;
  coworkers: number;
  agents: number;
  jobs: number;
  recentTurns: number;
}

/** Rhythms whose prompt carries its own packet of Tasks, mail and calendar. */
const BRIEFING_RHYTHMS = new Set([
  "standup",
  "weekly-wrap",
  "end-of-day",
  "follow-ups",
  "monday-plan",
  "monthly-review",
]);

export function sokoBotPacketKind(input: {
  source: string;
  scheduleKey: string | null;
}): SokoBotPacketKind {
  if (input.source === "INGEST") return "ingest";
  if (input.source === "EVENT") return "event";
  if (input.source !== "SCHEDULE") return "chat";
  if (input.scheduleKey === "dreaming") return "dreaming";
  if (input.scheduleKey === "memory-cleanup") return "memory";
  if (input.scheduleKey === "meeting-prep") return "meeting-prep";
  if (input.scheduleKey && BRIEFING_RHYTHMS.has(input.scheduleKey))
    return "rhythm";
  return "schedule";
}

/** A signal at or above this adds what the message is likely about. */
const LIKELY = 0.6;

const BOARD_TASKS = 16;
const WAITING_TASKS = 12;
const COWORKERS = 12;
const AGENTS = 24;
const OPEN_JOBS = 6;

const WORK_ROUTES = new Set<TurnClassification["route"]>([
  "MANAGE_WORK",
  "DELEGATE_TASK",
  "MIXED",
]);
const ASSIGN_ROUTES = new Set<TurnClassification["route"]>([
  "DELEGATE_TASK",
  "HIRE_AGENT",
  "MIXED",
]);
const HIRE_ROUTES = new Set<TurnClassification["route"]>([
  "HIRE_AGENT",
  "MIXED",
]);

const NOTHING: Omit<SokoBotPacketPlan, "kind"> = {
  tasks: 0,
  waitingTasks: 0,
  coworkers: 0,
  agents: 0,
  jobs: 0,
  recentTurns: 0,
};

export function sokoBotPacketPlan(
  kind: SokoBotPacketKind,
  classification: Pick<TurnClassification, "route" | "signals">,
): SokoBotPacketPlan {
  const { route, signals } = classification;
  const always = {
    ...NOTHING,
    waitingTasks: WAITING_TASKS,
    jobs: OPEN_JOBS,
  };
  switch (kind) {
    // The model sees only the recipient (`modelContextBlock`).
    case "meeting-prep":
      return { kind, ...NOTHING };
    case "memory":
      return { kind, ...NOTHING };
    // The activity since the last dream is in the prompt itself.
    case "dreaming":
      return { kind, ...NOTHING, recentTurns: 6 };
    // The rhythm's prompt lists the Tasks, mail and calendar it reports on.
    case "rhythm":
      return { kind, ...always, recentTurns: 3 };
    // New mail: what was already said, so the same alert is not repeated.
    case "ingest":
      return { kind, ...always, recentTurns: 6 };
    case "event":
      return {
        kind,
        ...always,
        tasks: BOARD_TASKS,
        coworkers: COWORKERS,
        recentTurns: 4,
      };
    case "schedule":
    case "chat": {
      const aboutTasks = (signals?.aboutTasks ?? 0) >= LIKELY;
      return {
        kind,
        ...always,
        tasks: WORK_ROUTES.has(route) || aboutTasks ? BOARD_TASKS : 0,
        coworkers: ASSIGN_ROUTES.has(route) ? COWORKERS : 0,
        agents: HIRE_ROUTES.has(route) ? AGENTS : 0,
        recentTurns: (signals?.refersToEarlier ?? 0) >= LIKELY ? 12 : 8,
      };
    }
  }
}

/** Drops what says nothing: null, false, 0, empty lists and empty objects. */
export function compactItem(
  item: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(item).flatMap(([key, value]) => {
      if (key === "trust" || value === null || value === false || value === 0)
        return [];
      if (Array.isArray(value)) {
        if (!value.length) return [];
        return [
          [
            key,
            value.map((entry) =>
              entry && typeof entry === "object" && !Array.isArray(entry)
                ? compactItem(entry as Record<string, unknown>)
                : entry,
            ),
          ],
        ];
      }
      if (value && typeof value === "object") {
        const inner = compactItem(value as Record<string, unknown>);
        return Object.keys(inner).length ? [[key, inner]] : [];
      }
      return [[key, value]];
    }),
  );
}

/** Each `## Section` of the memory document and how many entries it holds. */
export function memorySections(markdown: string): Record<string, number> {
  const sections: Record<string, number> = {};
  let current: string | null = null;
  for (const line of markdown.split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading?.[1]) {
      current = heading[1];
      sections[current] = 0;
    } else if (current && /^\s*[-*]\s+\S/.test(line)) {
      sections[current] = (sections[current] ?? 0) + 1;
    }
  }
  return sections;
}

/**
 * A source of messages the bot can read beyond its own chat: chat rooms
 * today, X DMs or Telegram when those land. Each says how to read it.
 */
export interface SokoBotMessageSource {
  id: string;
  what: string;
  read: string;
}

export interface SokoBotMessageSourceInput {
  /** Toolkits of the bot's ACTIVE integrations, by provider id. */
  providers: readonly string[];
  /** Only the owner's own turns read their private messages. */
  ownerTurn: boolean;
}

/** Add a messages source here; the map lists it when `available` holds. */
export const SOKO_BOT_MESSAGE_SOURCES: readonly (SokoBotMessageSource & {
  available: (input: SokoBotMessageSourceInput) => boolean;
})[] = [
  {
    id: "chats",
    what: "chat rooms you are in, and on the owner's turns their unread chats and direct messages",
    read: "list_chats, then read_chat",
    available: () => true,
  },
  {
    // X direct messages (v37 on): private to the owner, read like mail.
    id: "x-dms",
    what: "the owner's X direct messages",
    read: 'search_inbox and read_email with provider "twitter"',
    available: ({ providers, ownerTurn }) =>
      ownerTurn && providers.includes("twitter"),
  },
];

export function messageSources(
  input: SokoBotMessageSourceInput,
): SokoBotMessageSource[] {
  return SOKO_BOT_MESSAGE_SOURCES.filter((source) =>
    source.available(input),
  ).map(({ id, what, read }) => ({ id, what, read }));
}

/** What the map counts beyond the packet's own collections. */
export interface PacketMapFacts {
  plan: SokoBotPacketPlan;
  openTasks: number;
  waitingTasks: number;
  finishedThisWeek: number;
  memoryBytes: number;
  mail: string[];
  calendar: string[];
  /** Every ACTIVE integration's toolkit, for the messages sources. */
  providers: string[];
  privateAudience: boolean;
}

/**
 * The same collections, without what says nothing: no per-item trust label
 * (the packet header says it once), no empty fields, Project summaries only
 * for the bot's own Project, and Coworkers by name and caption.
 */
export function organizePacket(
  packet: Packet,
  ownProjectId: string | null,
): Packet {
  const items = (list: readonly Record<string, unknown>[]) =>
    list.map(compactItem);
  return {
    ...packet,
    actor: compactItem(packet.actor),
    projects: packet.projects.map((project) =>
      compactItem({
        id: project.id,
        name: project.name,
        tasks: (project.status as { totalTasks?: number } | undefined)
          ?.totalTasks,
        ...(project.id === ownProjectId
          ? { summary: project.summary, brandBrain: project.brandBrain }
          : {}),
      }),
    ),
    tasks: items(packet.tasks),
    coworkers: packet.coworkers.map((coworker) =>
      compactItem({
        id: coworker.id,
        name: coworker.name,
        caption: coworker.caption,
      }),
    ),
    agents: items(packet.agents),
    jobs: items(packet.jobs),
    pendingDecisions: items(packet.pendingDecisions),
    recentTurns: items(packet.recentTurns),
    sourceCoverage: undefined,
  };
}

/** Every source: how many exist, how many the packet shows, how to read the rest. */
export function packetMap(
  packet: Packet,
  facts: PacketMapFacts,
): Record<string, unknown> {
  const shownBytes = Buffer.byteLength(packet.memory.markdown, "utf8");
  const tasks = packet.tasks;
  return {
    tasks: {
      total: packet.counts.tasks ?? tasks.length,
      open: facts.openTasks,
      waitingOnOwner: facts.waitingTasks,
      finishedThisWeek: facts.finishedThisWeek,
      shown: tasks.length,
      read: "list_tasks (query, status, projectId, state, idleDays); get_task_status for one",
    },
    projects: {
      total: packet.counts.projects ?? packet.projects.length,
      shown: packet.projects.length,
      read: "read_context section projects",
    },
    coworkers: {
      total: packet.counts.coworkers ?? packet.coworkers.length,
      shown: packet.coworkers.length,
      read: "find_coworkers",
    },
    agents: {
      total: packet.counts.agents ?? packet.agents.length,
      shown: packet.agents.length,
      read: "find_agents",
    },
    jobs: {
      total: packet.counts.jobs ?? packet.jobs.length,
      shown: packet.jobs.length,
      read: "read_context section jobs; get_job_status for one",
    },
    conversation: {
      total: packet.counts.recentTurns ?? packet.recentTurns.length,
      shown: packet.recentTurns.length,
      read: "read_context section conversation",
    },
    decisions: {
      total: packet.counts.pendingDecisions ?? packet.pendingDecisions.length,
      shown: packet.pendingDecisions.length,
    },
    memory: {
      bytes: facts.memoryBytes,
      shownBytes,
      sections: memorySections(packet.memory.markdown),
      ...(shownBytes < facts.memoryBytes ? { read: "read_memory" } : {}),
    },
    ...(facts.privateAudience
      ? {}
      : {
          mail: facts.mail.length
            ? { connected: facts.mail, read: "search_inbox, read_email" }
            : { connected: [] },
          calendar: facts.calendar.length
            ? { connected: facts.calendar, read: "list_calendar_events" }
            : { connected: [] },
        }),
    schedules: {
      read: "list_schedules (scope workspace: everyone's, with who made each)",
    },
    contacts: { read: "search_contacts, count_contacts" },
    files: { read: "list_files, read_file" },
    messages: messageSources({
      providers: facts.providers,
      ownerTurn: !facts.privateAudience,
    }),
  };
}
