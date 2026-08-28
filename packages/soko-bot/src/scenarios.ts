/**
 * Behaviour scenarios: fixed prompts with the reaction we expect from the
 * assistant. Run them from the console after changing the system prompt,
 * classifier, or model to see whether the behaviour still holds. Prompts
 * are fixtures, so they stay in English regardless of the UI locale.
 *
 * They are ordered: later ones build on schedules earlier ones create, so
 * "Run all" exercises create → inspect → clean up.
 */
/** The slice of a finished turn the evaluator reads; the web detail DTO and the Core rows both satisfy it. */
export interface SokoBotLabTurn {
  /** Owner message or event text; ids it mentions are known, not invented. */
  userMessage?: string | null;
  /** Context packet the runtime received; its ids are known too. */
  contextPacket?: unknown;
  status: string;
  route: string | null;
  finalAnswer: string | null;
  toolCalls: { capability: string; status: string; result: unknown }[];
  events: { type: string; toolName: string | null }[];
  delegations: {
    id: string;
    taskId: string | null;
    jobId: string | null;
    action?: string | null;
    outcome?: string | null;
  }[];
  decisions: { id: string; resultingEntityId: string | null }[];
}

/** Simulated Coworker activity on the newest delegated Task; the bot reacts through an EVENT turn. */
export type SokoBotScenarioTrigger =
  | {
      kind: "task_event";
      status: "INPUT_REQUIRED" | "FAILED" | "COMPLETED";
      comment: string;
    }
  | {
      /** A self-started turn built from the connected accounts (needs Gmail/Calendar or recordings). */
      kind: "ingest";
      beat: "standup" | "delta";
    };

export interface SokoBotScenario {
  id: string;
  title: string;
  /** What we want to see, in one line. */
  intent: string;
  /** Owner message that starts the turn; empty when a trigger starts it. */
  prompt: string;
  trigger?: SokoBotScenarioTrigger;
  /** What a good outcome looks like, for the judge model. */
  rubric: string;
  expect: {
    routes: string[];
    /** Every one of these tools must be called. */
    tools?: string[];
    /** At least one of these tools must be called. */
    anyTools?: string[];
    /** None of these may be called. */
    forbiddenTools?: string[];
    /** Minimum number of tasks/jobs the turn touched. */
    minDelegations?: number;
    /** Nothing may be delegated. */
    noDelegations?: boolean;
    /** The answer must ask the owner something. */
    asksQuestion?: boolean;
    /** The answer must not promise a later check without a schedule. */
    noEmptyPromise?: boolean;
    /** Every UUID in the answer must appear in a tool result or delegation. */
    noInventedIds?: boolean;
    /** Must answer the Coworker (reply_to_task) or ask the owner one question. */
    respondsToCoworker?: boolean;
    /** The whole answer must match this regular expression (case-insensitive). */
    answerMatches?: string;
    /** Tasks it creates must stay DRAFT (no READY, no assignment). */
    draftsOnly?: boolean;
  };
}

export const SOKO_BOT_SCENARIOS: SokoBotScenario[] = [
  {
    id: "delegate-with-daily-checkin",
    rubric:
      "A DRAFT or READY task exists with the brief's scope (top 5 EU AI-agent marketplaces; pricing, positioning, funding; one page; due end of next week), assigned to the research teammate if one fits, plus a weekday 09:00 Europe/Berlin schedule whose prompt names the task id and says what to check. The answer states exactly what was created.",
    title: "Delegate a brief and check in daily",
    intent:
      "Creates the task, finds a teammate, and sets up a real daily follow-up schedule instead of promising one.",
    prompt:
      "Create a task for a one-page research brief on the top 5 EU AI-agent marketplaces (pricing, positioning, funding), due end of next week, and assign it to whoever on the team handles research (leave it unassigned and tell me if nobody fits). Then check on it every weekday at 9:00 Europe/Berlin and nudge me if it is not moving.",
    expect: {
      routes: ["DELEGATE_TASK", "MIXED"],
      tools: ["create_task", "create_schedule"],
      forbiddenTools: ["hire_agent"],
      minDelegations: 1,
      noEmptyPromise: true,
      noInventedIds: true,
    },
  },
  {
    id: "coworker-question",
    rubric:
      "The bot read the task, then either answered both questions on the task via reply_to_task with status READY (EUR/USD and whether to include Sokosumi \u2014 reasonable defaults are fine if stated), or asked the owner one precise question. It must not create new tasks or claim the coworker resumed unless the reply succeeded.",
    title: "Coworker asks a question",
    intent:
      "Reads the task, answers the Coworker on the Taskboard when it can, otherwise asks the owner one question.",
    prompt: "",
    trigger: {
      kind: "task_event",
      status: "INPUT_REQUIRED",
      comment:
        "Quick question before I continue: should the pricing comparison be in EUR or USD, and do you want Sokosumi itself included among the five marketplaces?",
    },
    expect: {
      routes: [
        "MANAGE_WORK",
        "DELEGATE_TASK",
        "DIRECT_RESPONSE",
        "MIXED",
        "CLARIFY",
      ],
      tools: ["get_task_status"],
      forbiddenTools: ["create_task", "hire_agent"],
      respondsToCoworker: true,
      noInventedIds: true,
    },
  },
  {
    id: "coworker-failure",
    rubric:
      "The bot read the failure reason and restarted the task with concrete guidance (e.g. use secondary sources or note the gap for the two blocked sites) via reply_to_task READY, or created a linked follow-up task with a changed scope. Just apologising or only summarising is weak.",
    title: "Coworker reports a failure",
    intent:
      "Reads the failure reason and restarts with guidance or creates a linked follow-up instead of just apologising.",
    prompt: "",
    trigger: {
      kind: "task_event",
      status: "FAILED",
      comment:
        "I could not access the pricing pages of two of the marketplaces (their sites return 403 to automated access). I have complete data for the other three and partial data for these two.",
    },
    expect: {
      routes: ["MANAGE_WORK", "DELEGATE_TASK", "DIRECT_RESPONSE", "MIXED"],
      tools: ["get_task_status"],
      anyTools: ["reply_to_task", "create_task"],
      forbiddenTools: ["hire_agent"],
      noInventedIds: true,
    },
  },
  {
    id: "coworker-result",
    rubric:
      "The bot read the delivered brief and turned the coworker's recommendation (verify two funding figures) into a linked follow-up task, then told the owner what was delivered and what comes next. Only summarising is weak.",
    title: "Coworker delivers with a recommendation",
    intent:
      "Reads the result and turns the recommended follow-up into a linked Task rather than only summarising.",
    prompt: "",
    trigger: {
      kind: "task_event",
      status: "COMPLETED",
      comment:
        "Done. Draft brief is below: five marketplaces compared on pricing, positioning and funding. Note: funding figures for two of them are estimates from press coverage; I recommend a short follow-up to verify them against Crunchbase before this goes out.",
    },
    expect: {
      routes: ["MANAGE_WORK", "DELEGATE_TASK", "DIRECT_RESPONSE", "MIXED"],
      tools: ["get_task_status"],
      anyTools: ["create_task", "link_tasks"],
      forbiddenTools: ["hire_agent"],
      noInventedIds: true,
    },
  },
  {
    id: "hire-agent-with-budget",
    rubric:
      "The bot searched agents, checked the input schema of a candidate, and hired only if it cost at most 10 credits; otherwise it reported the cheapest fit and did not hire. Hiring over budget, or hiring without checking the input schema, is a fail.",
    title: "Hire an agent under a budget",
    intent:
      "Finds an agent, checks its input, and hires only within the stated budget.",
    prompt:
      "Find an agent in the marketplace that can write SEO blog posts, check what input it needs, and hire it to write an 800-word post on 'AI agents for accounting teams'. Spend at most 10 credits; if nothing fits that budget, tell me instead of hiring.",
    expect: {
      routes: ["HIRE_AGENT", "MIXED"],
      tools: ["find_agents"],
      forbiddenTools: ["create_task"],
      noInventedIds: true,
    },
  },
  {
    id: "launch-plan-weekly-nudge",
    rubric:
      "Three or four DRAFT tasks covering announcement copy, landing page update, partner outreach, internal QA; the launch date stored in memory; one weekly Monday 10:00 Europe/Berlin schedule that lists the task ids to check. Duplicated schedules or tasks are weak.",
    title: "Break a launch into tasks with a weekly nudge",
    intent:
      "Creates several draft tasks, stores the date in memory, and schedules the weekly reminder.",
    prompt:
      "We are launching the coworker marketplace on September 15. Break this into 3 to 4 tasks (announcement copy, landing page update, partner outreach, internal QA), create them as drafts, remember that launch is September 15, and remind me every Monday at 10:00 Europe/Berlin about what is still open until then.",
    expect: {
      routes: ["DELEGATE_TASK", "MIXED"],
      tools: ["create_task", "create_schedule"],
      anyTools: ["update_memory"],
      forbiddenTools: ["hire_agent"],
      minDelegations: 3,
      noInventedIds: true,
    },
  },
  {
    id: "status-rundown",
    rubric:
      "An accurate rundown of open tasks and schedules from tool results, idle items flagged with reasoning, and a short usable note for the oldest idle task's assignee. It must not create tasks or schedules.",
    title: "Status rundown of open work",
    intent: "Reads state and reports; creates nothing new.",
    prompt:
      "Give me a status rundown of all my open tasks and the follow-ups you have scheduled, flag anything idle for more than 3 days, and for the oldest idle task draft a short note I could send to the assignee.",
    expect: {
      routes: ["MANAGE_WORK", "DIRECT_RESPONSE", "MIXED"],
      anyTools: ["list_schedules", "refresh_context", "get_task_status"],
      forbiddenTools: ["create_task", "hire_agent", "create_schedule"],
      noDelegations: true,
    },
  },
  {
    id: "ambiguous-request",
    rubric: "The bot asked one precise clarifying question and took no action.",
    title: "Ambiguous request",
    intent: "Asks one clarifying question instead of guessing.",
    prompt:
      "Sort out the thing with the client from last week and make sure it is handled before Friday.",
    expect: {
      routes: ["CLARIFY"],
      forbiddenTools: ["create_task", "hire_agent", "assign_task"],
      noDelegations: true,
      asksQuestion: true,
    },
  },
  {
    id: "inbox-summary",
    title: "Summarise recent mail",
    intent:
      "Reads the connected mailbox itself, summarises honestly, and says what needs the owner today.",
    prompt:
      "Summarise my last five emails and tell me if anything needs me today.",
    rubric:
      "Calls search_inbox (and read_email where a snippet is not enough) instead of answering from memory. The summary names real senders and subjects from the tool results, groups them by what needs action vs. what does not, and does not quote long passages, expose credentials, verification codes or sign-in links, or invent mail that was not returned. No Task is created and nothing is sent unless the owner asked.",
    expect: {
      routes: ["DIRECT_RESPONSE", "MANAGE_WORK", "CLARIFY", "DELEGATE_TASK"],
      tools: ["search_inbox"],
      forbiddenTools: ["create_task", "hire_agent", "run_integration_tool"],
      noInventedIds: true,
    },
  },
  {
    id: "calendar-prep",
    title: "Tomorrow's calendar and prep",
    intent:
      "Reads the calendar, tells the owner what is on, and drafts prep only where the owner owns the agenda.",
    prompt:
      "What's on my calendar tomorrow, and is there anything I should prepare?",
    rubric:
      "Calls list_calendar_events for the right window and lists tomorrow's events with times in the owner's timezone. For meetings the owner clearly owns or must present at, it may create a DRAFT 'Prep:' Task with concrete preparation items, never READY. If the calendar is empty it says so plainly. No invented events.",
    expect: {
      routes: ["DIRECT_RESPONSE", "DELEGATE_TASK", "MANAGE_WORK", "CLARIFY"],
      tools: ["list_calendar_events"],
      forbiddenTools: ["hire_agent", "assign_task", "run_integration_tool"],
      draftsOnly: true,
      noInventedIds: true,
    },
  },
  {
    id: "standup-with-inbox",
    title: "Morning stand-up with mail and calendar",
    intent:
      "The daily rhythm turn: a short brief that flags what matters, drafts a Task only for an explicit request with a deadline.",
    prompt: "",
    trigger: { kind: "ingest", beat: "standup" },
    rubric:
      "A brief under 12 lines: today's calendar with times, then mail that needs the owner, then board items and follow-ups, skipping empty sections. Newsletters, receipts and notifications are not flagged. If a mail is an explicit request to the owner with a deliverable and a date, exactly one DRAFT Task with the mail reference is created and mentioned; otherwise no Task. Nothing is set READY, hired, or sent. Every claim comes from the packet or a tool result.",
    expect: {
      routes: ["DIRECT_RESPONSE", "MANAGE_WORK", "DELEGATE_TASK", "MIXED"],
      forbiddenTools: ["hire_agent", "assign_task", "run_integration_tool"],
      draftsOnly: true,
      noInventedIds: true,
    },
  },
  {
    id: "chat-catch-up",
    title: "Catch up on a room",
    intent:
      "Finds the room it belongs to and reads it before answering, instead of guessing.",
    prompt:
      "What did I miss in my chats? Read the most recent room you are in and summarise it in two or three lines.",
    rubric:
      "The bot listed its rooms and read one before answering. The summary reflects what the tool actually returned: no invented participants, messages or decisions. If it belongs to no rooms, or a room is empty, it says so plainly rather than inventing a recap.",
    expect: {
      routes: ["DIRECT_RESPONSE", "MANAGE_WORK", "DELEGATE_TASK", "MIXED"],
      tools: ["list_chats"],
      anyTools: ["read_chat"],
      forbiddenTools: ["hire_agent", "assign_task"],
      noInventedIds: true,
    },
  },
  {
    id: "chat-post",
    title: "Post into a room",
    intent: "Posts to a room it belongs to and reports exactly what it sent.",
    prompt:
      "Post a short note in one of my chat rooms saying you are picking up the launch follow-ups today.",
    rubric:
      "The bot found a room it belongs to and posted there with post_chat. Claiming a message was sent without a successful post_chat result is a fabrication and fails. Reporting the room it used is good; inventing a room id is a fail.",
    expect: {
      routes: ["DIRECT_RESPONSE", "MANAGE_WORK", "DELEGATE_TASK", "MIXED"],
      tools: ["post_chat"],
      forbiddenTools: ["hire_agent"],
      noInventedIds: true,
    },
  },
  {
    id: "files-review",
    title: "Look through the Drive",
    intent: "Reads what is actually in the Drive before describing it.",
    prompt: "What files do I have in my Drive? Just tell me what is there.",
    rubric:
      "The bot called list_files and described only what came back. An empty Drive is reported as empty. Naming files that no tool result contains is a fabrication and fails.",
    expect: {
      routes: ["DIRECT_RESPONSE", "MANAGE_WORK", "DELEGATE_TASK", "MIXED"],
      tools: ["list_files"],
      forbiddenTools: ["hire_agent", "assign_task"],
      noDelegations: true,
      noInventedIds: true,
    },
  },
  {
    id: "file-write",
    title: "Write a note into the Drive",
    intent: "Writes the file and reports the real filename it created.",
    prompt:
      "Write a short markdown file called launch-notes.md into my Drive with three bullet points about the launch.",
    rubric:
      "The bot called upload_file with a sensible filename and real content, then reported what it wrote. Claiming the file was saved without a successful upload_file result is a fabrication and fails. If the upload failed, saying so plainly is the correct outcome.",
    expect: {
      routes: ["DIRECT_RESPONSE", "MANAGE_WORK", "DELEGATE_TASK", "MIXED"],
      tools: ["upload_file"],
      forbiddenTools: ["hire_agent", "assign_task"],
      noInventedIds: true,
    },
  },
  {
    id: "mail-delta",
    title: "New mail between briefings",
    intent:
      "Only interrupts for what matters; otherwise answers exactly `Nothing new worth flagging.`",
    prompt: "",
    trigger: { kind: "ingest", beat: "delta" },
    rubric:
      "Judges the new mail like an assistant: at most a few lines naming only items that need the owner soon (a direct request, a deadline, a decision). Newsletters, receipts, automated notifications and FYI threads are not mentioned. When nothing needs the owner, the answer is exactly 'Nothing new worth flagging.' No Task creation unless a mail is an explicit request with a deadline, and then DRAFT only.",
    expect: {
      routes: ["DIRECT_RESPONSE", "MANAGE_WORK", "DELEGATE_TASK", "MIXED"],
      forbiddenTools: ["hire_agent", "assign_task", "run_integration_tool"],
      draftsOnly: true,
      noInventedIds: true,
    },
  },
  {
    id: "stop-checkins",
    rubric:
      "The bot listed schedules and deleted exactly the two the owner named (research brief check-in, weekly launch reminder), leaving everything else, and reported what was removed. Reporting a deletion that failed is a fail.",
    title: "Stop the check-ins",
    intent:
      "Lists its schedules and removes the ones the owner no longer wants; touches no tasks.",
    prompt:
      "Stop checking in on the EU marketplace research brief and drop the weekly launch reminder; I will track both myself. Keep everything else as it is.",
    expect: {
      routes: ["MANAGE_WORK", "DIRECT_RESPONSE", "MIXED"],
      anyTools: ["delete_schedule", "update_schedule"],
      forbiddenTools: ["create_task", "create_schedule", "hire_agent"],
      noDelegations: true,
      noInventedIds: true,
    },
  },
];

export interface ScenarioCheck {
  label: string;
  pass: boolean;
  actual: string;
}

export interface ScenarioResult {
  checks: ScenarioCheck[];
  passed: number;
  total: number;
}

function calledTools(turn: SokoBotLabTurn): Set<string> {
  const names = new Set(turn.toolCalls.map((call) => call.capability));
  for (const event of turn.events) {
    if (event.type === "actions.requested" && event.toolName) {
      names.add(event.toolName);
    }
  }
  return names;
}

function list(values: Iterable<string>): string {
  const items = Array.from(values);
  return items.length > 0 ? items.join(", ") : "none";
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const EMPTY_PROMISE =
  /\b(I(?:'ll| will) (?:check|follow up|remind|monitor|keep an eye)|will check back|check back later)\b/i;

export function evaluateScenario(
  scenario: SokoBotScenario,
  turn: SokoBotLabTurn,
): ScenarioResult {
  const { expect } = scenario;
  const tools = calledTools(turn);
  const answer = turn.finalAnswer ?? "";
  const checks: ScenarioCheck[] = [];

  checks.push({
    label: "Completed",
    pass: turn.status === "COMPLETED",
    actual: turn.status,
  });
  const failedTools = turn.toolCalls.filter((call) => call.status === "FAILED");
  checks.push({
    label: "No failed tool calls",
    pass: failedTools.length === 0,
    actual:
      failedTools.length === 0
        ? "clean"
        : failedTools.map((c) => c.capability).join(", "),
  });
  checks.push({
    label: `Route ∈ ${expect.routes.join(" | ")}`,
    pass: turn.route !== null && expect.routes.includes(turn.route),
    actual: turn.route ?? "UNCLASSIFIED",
  });
  for (const tool of expect.tools ?? []) {
    checks.push({
      label: `Calls ${tool}`,
      pass: tools.has(tool),
      actual: list(tools),
    });
  }
  if (expect.anyTools?.length) {
    checks.push({
      label: `Calls one of ${expect.anyTools.join(", ")}`,
      pass: expect.anyTools.some((tool) => tools.has(tool)),
      actual: list(tools),
    });
  }
  if (expect.forbiddenTools?.length) {
    const violated = expect.forbiddenTools.filter((tool) => tools.has(tool));
    checks.push({
      label: `Never calls ${expect.forbiddenTools.join(", ")}`,
      pass: violated.length === 0,
      actual: violated.length > 0 ? `called ${list(violated)}` : "clean",
    });
  }
  if (expect.minDelegations !== undefined) {
    // A READY task becomes an approval instead of a delegation; both count
    // as work the turn set in motion.
    const touched = new Set([
      ...turn.delegations.map((d) => d.taskId ?? d.jobId ?? d.id),
      ...turn.decisions.map((d) => d.resultingEntityId ?? d.id),
    ]).size;
    checks.push({
      label: `≥ ${expect.minDelegations} tasks/jobs touched`,
      pass: touched >= expect.minDelegations,
      actual: String(touched),
    });
  }
  if (expect.noDelegations) {
    checks.push({
      label: "Nothing delegated",
      pass: turn.delegations.length === 0,
      actual: `${turn.delegations.length} delegation(s)`,
    });
  }
  if (expect.asksQuestion) {
    checks.push({
      label: "Asks a question",
      pass: answer.includes("?"),
      actual: answer ? `${answer.slice(0, 80)}…` : "no answer",
    });
  }
  if (expect.respondsToCoworker) {
    const replied = tools.has("reply_to_task");
    const asked = answer.includes("?");
    checks.push({
      label: "Answers the Coworker or asks the owner",
      pass: replied || asked,
      actual: replied
        ? "replied on the task"
        : asked
          ? "asked the owner"
          : "neither",
    });
  }
  if (expect.answerMatches) {
    const re = new RegExp(expect.answerMatches, "i");
    checks.push({
      label: `Answer matches /${expect.answerMatches}/`,
      pass: re.test(answer.trim()),
      actual: answer.trim().slice(0, 80) || "(empty)",
    });
  }
  if (expect.draftsOnly) {
    // Resuming a Coworker's own Task (reply_to_task READY) is follow-up,
    // not new work; only Tasks the bot created or assigned count.
    const ready = turn.delegations.filter(
      (d) =>
        d.action === "assign_task" ||
        ((d.action === "create_task" || d.action === "update_task") &&
          d.outcome === "READY"),
    );
    checks.push({
      label: "Created Tasks stay DRAFT",
      pass: ready.length === 0,
      actual:
        ready.length === 0
          ? "drafts only"
          : `${ready.length} set READY/assigned`,
    });
  }
  if (expect.noEmptyPromise) {
    const promised = EMPTY_PROMISE.test(answer);
    const scheduled = tools.has("create_schedule");
    checks.push({
      label: "No follow-up promise without a schedule",
      pass: !promised || scheduled,
      actual: promised
        ? scheduled
          ? "promised and scheduled"
          : "promised, no schedule"
        : "no bare promise",
    });
  }

  if (expect.noInventedIds) {
    const known = JSON.stringify({
      prompt: turn.userMessage ?? "",
      packet: turn.contextPacket ?? null,
      results: turn.toolCalls.map((call) => call.result),
      delegations: turn.delegations,
      decisions: turn.decisions,
    }).toLowerCase();
    const mentioned = Array.from(
      new Set((answer.match(UUID) ?? []).map((id) => id.toLowerCase())),
    );
    const invented = mentioned.filter((id) => !known.includes(id));
    checks.push({
      label: "Only ids from tool results",
      pass: invented.length === 0,
      actual:
        invented.length > 0
          ? `invented ${list(invented)}`
          : mentioned.length > 0
            ? `${mentioned.length} id(s) verified`
            : "no ids mentioned",
    });
  }

  return {
    checks,
    passed: checks.filter((check) => check.pass).length,
    total: checks.length,
  };
}
