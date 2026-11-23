import { handoffRequestBlock } from "@/lib/soko-bot/handoff-request";

/**
 * The stand-up thread as people read it: what needs a person first, then the
 * matches, then one line per agent, then one summary line. Pure, so the text
 * a run posts is the text its tests read.
 */

export const STANDUP_ROOM_NAME = "Stand-up";
export const STANDUP_METADATA_KEY = "team_standup";

/** A stand-up's own thread message: Core wrote it, with no person or agent as sender. */
export function isStandupHostMessage(message: {
  metadata: unknown;
  senderUserId: string | null;
  senderCoworkerId: string | null;
  senderSokoBotId: string | null;
}): boolean {
  return (
    !message.senderUserId &&
    !message.senderCoworkerId &&
    !message.senderSokoBotId &&
    typeof message.metadata === "object" &&
    message.metadata !== null &&
    STANDUP_METADATA_KEY in message.metadata
  );
}

export interface StandupAgent {
  kind: "sokoBot" | "coworker";
  id: string;
  name: string;
  /** A personal bot's owner; null for a Coworker or a shared bot. */
  ownerName: string | null;
}

export interface StandupBlocker {
  what: string;
  /** The person it waits on, mentioned by name in the thread. */
  waitsOn: { userId: string; name: string } | null;
}

export interface StandupLine {
  agent: StandupAgent;
  done: string[];
  today: string[];
  blocked: StandupBlocker[];
}

export interface StandupMatch {
  needingAgentId: string;
  offeringAgentId: string;
  need: string;
  offer: string;
}

/** Nothing done, due or blocked: this agent gets no line. */
export function lineIsEmpty(line: StandupLine): boolean {
  return (
    line.done.length === 0 &&
    line.today.length === 0 &&
    line.blocked.length === 0
  );
}

function agentLabel(agent: StandupAgent): string {
  return agent.ownerName && agent.kind === "sokoBot"
    ? `${agent.name} (${agent.ownerName}'s assistant)`
    : agent.name;
}

function list(all: string[]): string {
  const items = [...new Set(all)];
  return (
    items.slice(0, 3).join(", ") +
    (items.length > 3 ? ` (+${items.length - 3})` : "")
  );
}

export function standupHeader(input: {
  date: string;
  lines: StandupLine[];
  matches: StandupMatch[];
}): string {
  const people = new Set(
    input.lines.flatMap((line) =>
      line.blocked
        .filter((blocker) => blocker.waitsOn)
        .map((blocker) => blocker.what),
    ),
  ).size;
  return [
    `**Stand-up · ${input.date}**`,
    `${input.lines.length} agent${input.lines.length === 1 ? "" : "s"}`,
    ...(people ? [`${people} need${people === 1 ? "s" : ""} a person`] : []),
    ...(input.matches.length
      ? [
          `${input.matches.length} match${input.matches.length === 1 ? "" : "es"}`,
        ]
      : []),
  ].join(" · ");
}

export function formatStandup(input: {
  date: string;
  lines: StandupLine[];
  matches: StandupMatch[];
  summary: string;
}): string {
  const byId = new Map(input.lines.map((line) => [line.agent.id, line.agent]));
  const needsPerson = [
    ...new Set(
      input.lines.flatMap((line) =>
        line.blocked
          .filter((blocker) => blocker.waitsOn)
          .map(
            (blocker) =>
              `- @${blocker.waitsOn!.userId}: ${blocker.what} (${agentLabel(line.agent)})`,
          ),
      ),
    ),
  ];
  const matches = input.matches.map((match) => {
    const needing = byId.get(match.needingAgentId);
    const offering = byId.get(match.offeringAgentId);
    return `- ${needing ? agentLabel(needing) : "An agent"} needs ${match.need}; ${offering ? offering.name : "another agent"} ${match.offer}. Asked in the thread.`;
  });
  const lines = input.lines.map((line) => {
    const parts = [
      ...(line.done.length ? [`done: ${list(line.done)}`] : []),
      ...(line.today.length ? [`today: ${list(line.today)}`] : []),
      ...(line.blocked.length
        ? [`blocked: ${list(line.blocked.map((blocker) => blocker.what))}`]
        : []),
    ];
    return `- **${agentLabel(line.agent)}** · ${parts.join(" · ")}`;
  });
  return [
    standupHeader(input),
    ...(needsPerson.length ? ["", "**Needs a person**", ...needsPerson] : []),
    ...(matches.length ? ["", "**Matches**", ...matches] : []),
    "",
    "**Agents**",
    ...lines,
    "",
    input.summary.trim(),
  ].join("\n");
}

/** The hand-off a match opens: plain text, so a Coworker reading only text gets all of it. */
export function handoffMessage(input: {
  offeringHandle: string;
  need: string;
  context: string;
  askedFor: string;
}): string {
  return [
    `@${input.offeringHandle} from today's stand-up: ${input.askedFor}`,
    "",
    handoffRequestBlock({
      goal: input.need,
      background: input.context,
      deliverable:
        "what you already have on this (findings, files or links), or say you have nothing.",
      deadline: "today",
    }),
    "",
    "Just answer here; nobody is starting paid work from this.",
  ].join("\n");
}

/** What one person did in the week, counted from records they made. */
export interface PersonWeek {
  userId: string;
  name: string;
  /** Names of public Tasks they finished. */
  finished: string[];
  answered: number;
  assigned: number;
  approved: { strategies: number; newsletters: number };
  postsPublished: number;
  filesShared: number;
  tablesMade: number;
}

/** What one agent got done in the week. */
export interface AgentWeek {
  agent: StandupAgent;
  done: string[];
}

export const WEEK_OPT_OUT_PATH = "/account";

function counted(count: number, one: string, many: string): string[] {
  return count > 0 ? [`${count} ${count === 1 ? one : many}`] : [];
}

export function personWeekParts(person: PersonWeek): string[] {
  const finished = person.finished.length;
  return [
    ...(finished
      ? [
          `${finished} ${finished === 1 ? "Task" : "Tasks"} finished (${list(person.finished.map((name) => `"${name}"`))})`,
        ]
      : []),
    ...counted(person.answered, "Task answered", "Tasks answered"),
    ...counted(person.assigned, "Task handed out", "Tasks handed out"),
    ...counted(
      person.approved.strategies,
      "strategy approved",
      "strategies approved",
    ),
    ...counted(
      person.approved.newsletters,
      "newsletter approved",
      "newsletters approved",
    ),
    ...counted(person.postsPublished, "post published", "posts published"),
    ...counted(person.filesShared, "file shared", "files shared"),
    ...counted(person.tablesMade, "table made", "tables made"),
  ];
}

/** The week-in-review thread: one line per person, one per agent, one summary line. */
export function formatWeekInReview(input: {
  dates: string;
  people: PersonWeek[];
  agents: AgentWeek[];
  summary: string;
}): string {
  const people = input.people.map(
    (person) => `- **${person.name}** · ${personWeekParts(person).join(" · ")}`,
  );
  const agents = input.agents.map(
    (line) => `- **${agentLabel(line.agent)}** · ${list(line.done)}`,
  );
  return [
    [
      `**Week in review · ${input.dates}**`,
      ...counted(input.people.length, "person", "people"),
      ...counted(input.agents.length, "agent", "agents"),
    ].join(" · "),
    ...(people.length ? ["", "**People**", ...people] : []),
    ...(agents.length ? ["", "**Agents**", ...agents] : []),
    "",
    input.summary.trim(),
    "",
    `_Counted from public Tasks, approvals, posts, shared files and tables; never mail, calendars, direct messages or private Tasks. To leave your week out, turn off "Include my week in the stand-up" in [your account settings](${WEEK_OPT_OUT_PATH})._`,
  ].join("\n");
}
