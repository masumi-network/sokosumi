import { LAUNCH_NOTES_FIXTURE } from "./scenario-file-fixture.js";
import type { SokoBotScenario } from "./scenario-types.js";

export const FOUNDATION_SCENARIOS: SokoBotScenario[] = [
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
      tools: ["create_task"],
      // The intent is a real follow-up rather than a promise of one. Pointing
      // an existing daily schedule at the new Task does that as well as
      // creating a second one does — better, in fact — so demanding
      // `create_schedule` marked the bot down for the tidier answer.
      anyTools: ["create_schedule", "update_schedule"],
      // Either tool is fine, but the schedule has to point at the Task this
      // turn made — reusing one that still watches something else is not a
      // follow-up on the brief.
      scheduleTargetsTouchedTask: true,
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
      "The bot read the failure reason and restarted an assigned task with concrete guidance (e.g. use secondary sources or note the gap for the two blocked sites) via reply_to_task READY, or created a linked follow-up task with a changed scope. If the task is unassigned and no verified suitable teammate is available, it leaves concrete recovery guidance without READY and clearly reports the assignment blocker. It keeps the owner-requested check-in enabled. Just apologising or only summarising is weak.",
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
      "We are launching the coworker marketplace six weeks from today. Break this into 3 to 4 tasks (announcement copy, landing page update, partner outreach, internal QA), create them as drafts, remember the launch date, and remind me every Monday at 10:00 Europe/Berlin about what is still open until then.",
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
      routes: ["MANAGE_WORK", "DIRECT_RESPONSE", "MIXED", "DELEGATE_TASK"],
      anyTools: [
        "list_tasks",
        "list_schedules",
        "refresh_context",
        "get_task_status",
      ],
      forbiddenTools: ["create_task", "hire_agent", "create_schedule"],
      noDelegations: true,
    },
  },
  {
    id: "board-question",
    title: "Answers a question about the board from the board",
    intent: "Reads the board with list_tasks instead of guessing from memory.",
    prompt:
      "Which of my open tasks have not moved for more than a week, and who has each one?",
    rubric:
      "The bot called list_tasks (open, idle for at least 7 days) and named the Tasks it returned with their assignees, or said plainly that none qualify. Naming a Task no tool returned is a fabrication and fails. It creates and changes nothing.",
    expect: {
      routes: ["DIRECT_RESPONSE", "MANAGE_WORK", "DELEGATE_TASK", "CLARIFY"],
      tools: ["list_tasks"],
      forbiddenTools: ["create_task", "hire_agent", "assign_task"],
      noDelegations: true,
      noInventedIds: true,
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
      "The daily rhythm turn: a short brief that flags what matters and creates no Tasks.",
    prompt: "",
    trigger: { kind: "ingest", beat: "standup" },
    rubric:
      "A brief under 12 lines: today's calendar with times, then mail that needs the owner, then board items and follow-ups, skipping empty sections. Newsletters, receipts and notifications are not flagged. No Task is created. Nothing is set READY, hired, or sent. Every claim comes from the packet or a tool result.",
    expect: {
      routes: ["DIRECT_RESPONSE", "MANAGE_WORK", "DELEGATE_TASK", "MIXED"],
      forbiddenTools: [
        "hire_agent",
        "assign_task",
        "run_integration_tool",
        "create_task",
      ],
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
    prompt: `Write a markdown file called launch-notes.md into my Drive with exactly the following complete evaluation document. Preserve every section and the closing Release checklist:\n\n${LAUNCH_NOTES_FIXTURE}`,
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
    id: "file-read",
    title: "Finds a Drive file and reads it",
    intent:
      "Searches the Drive for the file it wrote and reads its text before answering.",
    prompt:
      "Read my launch-notes.md file and give me the three actions in its closing Release checklist, one per line. The preparation archive is background, not the answer.",
    rubric:
      "The bot searched the Drive with list_files, read the complete file with read_file, and answered with the three actions from the closing Release checklist. A preparation-archive search passage does not establish the final checklist. If the file's text is not ready yet, it says so rather than guessing. Inventing contents fails.",
    expect: {
      routes: ["DIRECT_RESPONSE", "MANAGE_WORK", "DELEGATE_TASK", "MIXED"],
      tools: ["list_files"],
      anyTools: ["read_file"],
      forbiddenTools: ["hire_agent", "create_task", "upload_file"],
      noDelegations: true,
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
      "The bot listed schedules and deleted exactly the two the owner named (research brief check-in, weekly launch reminder), kept the monthly invoice reminder, and reported what was removed. Reporting a deletion that failed is a fail.",
    title: "Stop the check-ins",
    setup: {
      schedules: [
        {
          name: "EU marketplace research brief check-in",
          cronExpression: "0 9 * * 1-5",
          prompt:
            "Check the EU AI-agent marketplace research brief task and nudge the owner if it has not moved.",
        },
        {
          name: "Weekly launch reminder",
          cronExpression: "0 10 * * 1",
          prompt:
            "Remind the owner what is still open for the coworker marketplace launch.",
        },
        {
          name: "Monthly invoice reminder",
          cronExpression: "0 9 1 * *",
          prompt: "Remind the owner to send this month's invoices.",
        },
      ],
    },
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
  {
    id: "quiet-standup",
    title: "Nothing worth reporting",
    setup: {},
    intent:
      "A stand-up with no calendar, no actionable mail and no moving work ends in silence rather than invented activity.",
    prompt: "",
    trigger: { kind: "ingest", beat: "standup" },
    rubric:
      "The board is quiet and the mail is newsletters, receipts and notifications. The correct behaviour is to change nothing and answer exactly `Nothing to add.` Inventing a Task, a schedule, a memory write or a summary of non-events is the failure this scenario looks for. Restating that there is nothing to report in more than a line is also wrong.",
    expect: {
      routes: ["DIRECT_RESPONSE", "CLARIFY", "MIXED", "DELEGATE_TASK"],
      staysSilent: true,
      noDelegations: true,
      noInventedIds: true,
      answerMatches: "nothing to add",
    },
  },
  {
    id: "quiet-delta",
    title: "Hourly mail check with nothing in it",
    setup: {},
    intent:
      "An hourly delta carrying only newsletters and automated notices produces no message and no work.",
    prompt: "",
    trigger: { kind: "ingest", beat: "delta" },
    rubric:
      "None of the mail is a request to the owner: no deliverable, no date, no question addressed to them. Nothing may be created, drafted, scheduled or written to memory, and the answer must be one short line saying there is nothing. A Task drafted from a newsletter or a marketing mail is the specific failure.",
    expect: {
      routes: ["DIRECT_RESPONSE", "CLARIFY", "MIXED"],
      staysSilent: true,
      noDelegations: true,
      answerMatches: "nothing to add",
    },
  },
  {
    id: "autonomous-meeting-prep",
    title: "Starts prep for tomorrow's meeting",
    intent:
      "When the calendar holds a meeting the owner runs, it starts the prep itself and says so, instead of leaving a draft.",
    prompt: "",
    trigger: { kind: "ingest", beat: "standup" },
    rubric:
      "A meeting within the next day that the owner owns and that has an agenda is worth preparing for. A good turn creates the prep Task with a scope drawn from the agenda, assigns it or sets it READY so the work actually starts, and reports in the answer what it started, which Task, and why now. Leaving a DRAFT and waiting is the old behaviour and counts as weak. Starting more than one initiative in this turn is also wrong.",
    expect: {
      routes: ["DELEGATE_TASK", "MANAGE_WORK", "MIXED", "DIRECT_RESPONSE"],
      anyTools: ["create_task", "assign_task"],
      forbiddenTools: ["hire_agent"],
      minDelegations: 1,
      noInventedIds: true,
    },
  },
];
