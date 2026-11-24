import { handoffRequestBlock } from "@/lib/soko-bot/handoff-request";

/**
 * The stand-up as people read it: a short opener, then one message per
 * agent under its own name. Pure, so the text a run posts is the text its
 * tests read.
 */

export const STANDUP_ROOM_NAME = "Stand-up";
export const STANDUP_METADATA_KEY = "team_standup";

/** A stand-up's own message (the opener): Core wrote it, with no person or agent as sender. */
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

export interface StandupPerson {
  userId: string;
  name: string;
}

export interface StandupWait {
  task: string;
  failed: boolean;
  /** The person it waits on, mentioned in the agent's message. */
  waitsOn: StandupPerson | null;
}

/** What one agent's records say since the last stand-up: public Task names and counts only. */
export interface AgentRecord {
  agent: StandupAgent;
  /** A bot's shared work, counted ("5 files saved"). */
  counts: string[];
  /** A bot's public Tasks it created, answered or handed out ("created \"X\""). */
  touched: string[];
  /** Public Tasks finished (Coworkers). */
  finished: string[];
  /** Public Tasks it is working on, or a bot handed out and are still running. */
  working: string[];
  /** A bot owner's public Tasks nobody has yet. */
  open: string[];
  waiting: StandupWait[];
}

export interface StandupMatch {
  needingAgentId: string;
  offeringAgentId: string;
  need: string;
  offer: string;
}

export function emptyRecord(agent: StandupAgent): AgentRecord {
  return {
    agent,
    counts: [],
    touched: [],
    finished: [],
    working: [],
    open: [],
    waiting: [],
  };
}

/** Nothing done, due or blocked: this agent posts nothing. */
export function recordIsEmpty(record: AgentRecord): boolean {
  return (
    record.counts.length === 0 &&
    record.finished.length === 0 &&
    record.working.length === 0 &&
    record.open.length === 0 &&
    record.waiting.length === 0
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

function plainList(all: string[], max = 3): string {
  const items = [...new Set(all)];
  const shown = items.slice(0, max);
  const more = items.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  if (shown.length < 2) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}`;
}

/** "Finished: a, b." with no full stop after a cut-short name. */
function sentence(label: string, items: string[], max?: number): string {
  const text = `${label}${plainList(items, max)}`;
  return text.endsWith("…") ? text : `${text}.`;
}

export function mentionToken(person: StandupPerson): string {
  return `@${person.userId}`;
}

export function standupOpener(date: string): string {
  return `**Stand-up · ${date}**`;
}

/** What the agent did, in the week's words: counts for bots, quoted names for Coworkers. */
export function recordDone(record: AgentRecord): string[] {
  return [...record.counts, ...record.finished.map((name) => `"${name}"`)];
}

/** Waits grouped per person, so one line names each person once. */
function waitLines(waiting: StandupWait[], short: (task: string) => string) {
  const byPerson = new Map<
    string,
    { person: StandupPerson; tasks: string[] }
  >();
  const failed: string[] = [];
  const unowned: string[] = [];
  for (const wait of waiting) {
    if (wait.failed) failed.push(short(wait.task));
    else if (wait.waitsOn) {
      const entry = byPerson.get(wait.waitsOn.userId) ?? {
        person: wait.waitsOn,
        tasks: [],
      };
      entry.tasks.push(short(wait.task));
      byPerson.set(wait.waitsOn.userId, entry);
    } else unowned.push(short(wait.task));
  }
  return [
    ...[...byPerson.values()].map(({ person, tasks }) =>
      sentence(`Waiting on ${mentionToken(person)}: `, tasks),
    ),
    ...(unowned.length ? [sentence(`Waiting for an answer: `, unowned)] : []),
    ...(failed.length ? [sentence(`Failed: `, failed)] : []),
  ];
}

/** A Coworker's stand-up message: Core writes it, since a Coworker only reads Task text. */
export function coworkerStandupMessage(
  record: AgentRecord,
  short: (task: string) => string = (task) => task,
): string {
  const finished = [...new Set(record.finished.map(short))];
  const working = [...new Set(record.working.map(short))].filter(
    (task) => !finished.includes(task),
  );
  return [
    ...(finished.length ? [sentence(`Finished: `, finished)] : []),
    ...(working.length ? [sentence(`Working on: `, working)] : []),
    ...waitLines(record.waiting, short),
  ].join("\n");
}

/** A bot's message when its own words cannot be shown: the record, in the first person. */
export function botFallbackMessage(record: AgentRecord): string {
  const did = [...record.counts];
  return [
    did.length
      ? sentence(`Since the last stand-up: `, did, 4)
      : "Nothing finished since the last stand-up.",
    ...(record.working.length
      ? [sentence(`Still running: `, record.working)]
      : []),
    ...(record.open.length
      ? [
          sentence(
            `Open${record.agent.ownerName ? ` on ${record.agent.ownerName}'s list` : ""}, nobody has it yet: `,
            record.open,
          ),
        ]
      : []),
    ...waitLines(record.waiting, (task) => task),
  ].join("\n");
}

/** The people a record waits on: each must be mentioned in the agent's message. */
export function peopleWaitedOn(record: AgentRecord): StandupPerson[] {
  const people = new Map<string, StandupPerson>();
  for (const wait of record.waiting)
    if (wait.waitsOn && !wait.failed)
      people.set(wait.waitsOn.userId, wait.waitsOn);
  return [...people.values()];
}

/** A message that names a waited-on person without the mention token gets one, so they hear of it. */
export function withMentions(text: string, people: StandupPerson[]): string {
  const missing = people.filter(
    (person) => !text.includes(mentionToken(person)),
  );
  return missing.length
    ? `${text}\ncc ${missing.map(mentionToken).join(" ")}`
    : text;
}

const SHORT_TITLE_MAX = 48;

/** Plain-word names for Task titles, by rules when the model cannot help. */
export function shortTitleByRules(title: string): string {
  const cleaned = title
    .replace(/\s*[([].*?[)\]]\s*/g, " ")
    .replace(/,?\s*\b\d{4}-\d{2}-\d{2}\b/g, "")
    .replace(/@(?=\w)/g, "")
    .split(/\s+[—–-]\s+/)[0]!
    .replace(/\s+/g, " ")
    .trim();
  let text = cleaned || title;
  const colon = text.indexOf(": ");
  if (colon > 0 && text.length > SHORT_TITLE_MAX) {
    const head = text.slice(0, colon);
    text = head.split(" ").length >= 3 ? head : text.slice(colon + 2);
  }
  if (text.length <= SHORT_TITLE_MAX) return text;
  const cut = text.slice(0, SHORT_TITLE_MAX);
  return `${cut.slice(0, cut.lastIndexOf(" ")).trimEnd()}…`;
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
