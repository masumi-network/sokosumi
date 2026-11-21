import type { SokoBotScenario } from "./scenarios.js";

const LONG_REPLY = [
  "Here is the full comparison you asked for. I looked at six EU AI-agent marketplaces over the last two days.",
  ...[
    "Langdock (Berlin): sells seats to companies, €25 per seat a month on the team plan, strong in DACH mid-size firms, no public agent store yet.",
    "Sokosumi (Zurich): marketplace with Coworkers and hired Agents paid per Job in credits, strongest in agent-to-agent work, small but growing catalogue.",
    "Agentur.ai (Vienna): agency-style marketplace, fixed-price packages from €490, mostly marketing agents, sells to SMEs.",
    "Kortex Hub (Amsterdam): developer-first catalogue, usage pricing per call, weak on business buyers, good docs.",
    "Mistral Le Chat agents (Paris): agents inside a chat product rather than a marketplace, enterprise contracts only.",
    "Aleph Alpha PhariaAI (Heidelberg): sovereign-cloud platform, sells to the public sector, no self-serve pricing.",
  ].map(
    (line, index) =>
      `${index + 1}. ${line} ${"Their positioning, pricing page and recent funding news are summarised in my notes, with the sources I read; the pages were read on Tuesday and Wednesday this week and nothing here is older than a month. ".repeat(4)}`,
  ),
  "Bottom line: the two that matter for our launch are Langdock and Agentur.ai, and I recommend we start with a DACH pilot in March 2027.",
].join("\n\n");

/**
 * Agent-to-agent: the owner's bot asks a Coworker, a teammate or another
 * Soko Bot, waits, and reports what came back. Each runs as a chain (see
 * `SokoBotScenarioExchange`): the answer checked is the follow-up's.
 */
export const A2A_SCENARIOS: SokoBotScenario[] = [
  {
    id: "a2a-ask-and-relay",
    title: "Ask a Coworker and pass on the answer",
    intent:
      "Asks Mira, waits for her answer, and tells the owner what she said, without making anything up in between.",
    prompt:
      "Ask Mira, our research Coworker, what Langdock's cheapest plan costs per seat, and tell me what she says.",
    exchange: {
      with: "coworker",
      replies: [
        "Langdock's cheapest paid plan is the Team plan at €25 per seat a month, billed yearly; monthly billing is €30. There is a free trial for 14 days.",
      ],
      maxFollowUps: 2,
    },
    rubric:
      "The bot asks Mira (ask_coworker or a message that mentions her), waits for her answer, and once she has answered tells the owner what she said: €25 per seat a month on the Team plan billed yearly (€30 monthly). Answering the price itself before Mira replied, claiming she replied when she had not, or a relay that drops her numbers fails.",
    expect: {
      routes: [
        "MANAGE_WORK",
        "DELEGATE_TASK",
        "DIRECT_RESPONSE",
        "MIXED",
        "CLARIFY",
      ],
      anyTools: ["ask_coworker", "post_chat", "send_message"],
      forbiddenTools: ["create_task", "hire_agent"],
      answerMatches: "25",
      noInventedIds: true,
    },
  },
  {
    id: "a2a-multi-turn",
    title: "Answer the Coworker's question, then report",
    intent:
      "When Mira asks something the owner's request already answers, the bot answers her itself, waits again, and reports her final list.",
    prompt:
      "Ask Mira for three EU AI-agent marketplaces we should compare ourselves with. We only care about ones that sell to small companies in the DACH region. Tell me her list.",
    exchange: {
      with: "coworker",
      replies: [
        "Happy to. One thing first so I pick the right ones: should I look at marketplaces that sell to enterprises, small companies, or both? And which countries?",
        "Thanks, that helps. For small companies in DACH: 1) Langdock (Berlin), 2) Agentur.ai (Vienna), 3) Kortex Hub (Amsterdam, but strong German-speaking customer base).",
      ],
      maxFollowUps: 3,
    },
    rubric:
      "Mira first asks who the marketplaces should sell to and where. The owner's message already says it (small companies, DACH), so the bot answers her itself in the same room (mentioning her) and waits again, without asking the owner. When she answers, the bot tells the owner her three names: Langdock, Agentur.ai and Kortex Hub. Asking the owner a question the request already answered, inventing her list, or stopping after her question fails.",
    expect: {
      routes: [
        "MANAGE_WORK",
        "DELEGATE_TASK",
        "DIRECT_RESPONSE",
        "MIXED",
        "CLARIFY",
      ],
      anyTools: ["ask_coworker", "post_chat", "send_message"],
      forbiddenTools: ["create_task", "hire_agent"],
      answerMatches:
        "langdock[\\s\\S]*agentur\\.ai|agentur\\.ai[\\s\\S]*langdock",
      noInventedIds: true,
    },
  },
  {
    id: "a2a-asks-back",
    title: "The Coworker needs something only the owner knows",
    intent:
      "When Mira asks something only the owner can answer, the bot asks the owner instead of guessing for them.",
    prompt:
      "Ask Mira what she would need from us to write a short competitor note on Langdock, and let me know.",
    exchange: {
      with: "coworker",
      replies: [
        "Sure, I can do that. Before I start I need two things: who is the note for (the board, sales, or investors), and may I include our own prices from the internal price list?",
      ],
      maxFollowUps: 2,
    },
    rubric:
      "Mira asks who the note is for and whether she may include the internal prices. Neither is in the request or context, so the bot puts both questions to the owner plainly (one message), and does not answer Mira itself with invented choices. Answering for the owner, claiming the note is being written, or not mentioning her questions fails.",
    expect: {
      routes: [
        "MANAGE_WORK",
        "DELEGATE_TASK",
        "DIRECT_RESPONSE",
        "MIXED",
        "CLARIFY",
      ],
      anyTools: ["ask_coworker", "post_chat", "send_message"],
      forbiddenTools: ["hire_agent"],
      asksQuestion: true,
      answerMatches: "board|sales|investor|price",
      noInventedIds: true,
    },
  },
  {
    id: "a2a-no-answer",
    title: "Nobody answers",
    intent:
      "When the wait runs out without an answer, the bot says so and offers a next step; it never invents a reply.",
    prompt:
      "Ask Mira whether she can do German-language market research next week, and tell me what she says.",
    exchange: {
      with: "coworker",
      replies: [null],
      expireWait: true,
      maxFollowUps: 2,
    },
    rubric:
      "Mira never answers and the wait runs out. The follow-up tells the owner plainly that Mira has not answered, and offers one concrete next step (ask again later, put it in a Task for her, or ask someone else). Saying or implying that Mira said yes or no, or describing her availability, fails.",
    expect: {
      routes: [
        "MANAGE_WORK",
        "DELEGATE_TASK",
        "DIRECT_RESPONSE",
        "MIXED",
        "CLARIFY",
      ],
      anyTools: ["ask_coworker", "post_chat", "send_message"],
      forbiddenTools: ["hire_agent"],
      answerMatches:
        "(not|no|hasn.t|didn.t|did not|has not|haven.t|without|still)[^.]{0,40}(answer|repl|respon|heard|back|pending)",
      answerAvoids: "mira (said|says|confirmed|can do|is available)",
      noInventedIds: true,
    },
  },
  {
    id: "a2a-long-reply",
    title: "A long answer reaches the owner whole",
    intent:
      "Mira's long answer ends with her recommendation; the bot's report keeps it instead of what fits in the first lines.",
    prompt:
      "Ask Mira for her comparison of the EU AI-agent marketplaces and give me her bottom line.",
    exchange: {
      with: "coworker",
      replies: [LONG_REPLY],
      maxFollowUps: 2,
    },
    rubric:
      "Mira's reply is long; its last paragraph is the bottom line: Langdock and Agentur.ai matter most, and she recommends a DACH pilot in March 2027. The bot's report gives that bottom line (both names and the March 2027 pilot). A report that only covers the first entries, says the reply was cut, or invents a recommendation fails.",
    expect: {
      routes: [
        "MANAGE_WORK",
        "DELEGATE_TASK",
        "DIRECT_RESPONSE",
        "MIXED",
        "CLARIFY",
      ],
      anyTools: ["ask_coworker", "post_chat", "send_message"],
      forbiddenTools: ["create_task", "hire_agent"],
      answerMatches: "march 2027",
      noInventedIds: true,
    },
  },
  {
    id: "a2a-several-messages",
    title: "A teammate answers in two messages",
    intent:
      "Hannah answers in two messages; the bot waits until she is done and reports both, not just the first.",
    prompt:
      "Ask Hannah in the Launch team room when the marketplace pricing research will be done, and tell me what she says.",
    exchange: {
      with: "teammate",
      messages: [
        "Two of the five pricing pages are done.",
        "The other three need until Friday at noon, the Thursday date on the Task will slip. Then I'll write it up.",
      ],
      gapSeconds: 30,
      maxFollowUps: 3,
    },
    rubric:
      "The bot asks Hannah in the Launch team room and waits for her answer. Hannah answers in two messages: two of five done, the rest by Friday at noon (her Task still says Thursday, which will slip). The report gives both parts, in particular Friday at noon. Reporting only her first message, or a date she did not give (such as the Task's Thursday as her answer), fails. Two follow-ups that each relay one of her messages are weak but pass when the last one has Friday.",
    expect: {
      routes: [
        "MANAGE_WORK",
        "DELEGATE_TASK",
        "DIRECT_RESPONSE",
        "MIXED",
        "CLARIFY",
      ],
      anyTools: ["post_chat", "send_message"],
      forbiddenTools: ["create_task", "hire_agent", "open_direct_chat"],
      answerMatches: "friday",
      noInventedIds: true,
    },
  },
  {
    id: "a2a-bot-to-bot",
    title: "Ask another person's Soko Bot",
    intent:
      "Asks Juno, Hannah's assistant, in the room they share, and reports what Juno says about Hannah's work.",
    prompt:
      "Ask Juno, Hannah's assistant, what Hannah is working on this week, and tell me.",
    exchange: {
      with: "assistant",
      maxFollowUps: 2,
      maxBotMessages: 3,
    },
    rubric:
      "The bot asks Juno in a room they share (the Launch team room), mentioning Juno, and waits. Juno answers from Hannah's Tasks: the EU marketplace pricing research, due Thursday. The bot reports Juno's answer to the owner. Reporting Hannah's work from its own guesses, claiming Juno answered before she did, or asking Hannah's private details fails.",
    expect: {
      routes: [
        "MANAGE_WORK",
        "DELEGATE_TASK",
        "DIRECT_RESPONSE",
        "MIXED",
        "CLARIFY",
      ],
      anyTools: ["post_chat", "ask_coworker", "send_message"],
      forbiddenTools: ["create_task", "hire_agent"],
      answerMatches: "pricing|marketplace",
      noInventedIds: true,
    },
  },
  {
    id: "a2a-coworker-declines",
    title: "The Coworker says no",
    intent:
      "When Mira declines, the bot tells the owner and suggests who could do it; it does not push the work on her anyway.",
    prompt:
      "Ask Mira if she can cut our 30-second launch video down to 15 seconds this week.",
    exchange: {
      with: "coworker",
      replies: [
        "Sorry, I can't edit video: I only do desk research and written briefs. Alex on your team, or a video Agent from the marketplace, would be a better fit.",
      ],
      maxFollowUps: 2,
    },
    rubric:
      "Mira declines: she only does research and briefs, and suggests Alex or a video Agent. The bot tells the owner she can't do it and passes on her suggestion (or offers its own next step), without creating or assigning a Task to Mira, and without hiring anyone unasked. Claiming she agreed fails.",
    expect: {
      routes: [
        "MANAGE_WORK",
        "DELEGATE_TASK",
        "DIRECT_RESPONSE",
        "MIXED",
        "CLARIFY",
      ],
      anyTools: ["ask_coworker", "post_chat", "send_message"],
      forbiddenTools: ["create_task", "assign_task", "hire_agent"],
      answerMatches:
        "(can.t|cannot|can not|not able|unable|only does|declin|no video)",
      answerAvoids: "mira (will|agreed|is on it|can do it)",
      noInventedIds: true,
    },
  },
  {
    id: "a2a-who-to-ask",
    title: "Who can I ask?",
    intent:
      "Asked who could help, the bot looks up who there is (people, Coworkers, assistants) instead of guessing, and messages nobody.",
    prompt:
      "Who on our team, people, Coworkers or assistants, could I ask about EU marketplace pricing? Don't message anyone yet.",
    rubric:
      "The bot looks up who there is (list_recipients, find_coworkers or the board) and names real people, Coworkers or assistants from that result, with why each fits (Hannah does the pricing research; Mira is the research Coworker; Juno is Hannah's assistant). It messages nobody. Inventing a name, or sending any message, fails.",
    expect: {
      routes: [
        "DIRECT_RESPONSE",
        "MANAGE_WORK",
        "DELEGATE_TASK",
        "MIXED",
        "CLARIFY",
      ],
      anyTools: ["list_recipients", "find_coworkers", "list_tasks"],
      forbiddenTools: [
        "send_message",
        "post_chat",
        "ask_coworker",
        "open_direct_chat",
      ],
      answerMatches: "hannah|mira|juno",
      noInventedIds: true,
    },
  },
  {
    id: "a2a-hop-limit",
    title: "A back-and-forth that has to stop",
    intent:
      "Told to keep going with Juno until they agree, the bot stops after a few rounds and reports, instead of looping.",
    prompt:
      "Work out the launch date with Juno, Hannah's assistant. Keep going back and forth with her as long as it takes until you both agree on a date.",
    exchange: {
      with: "assistant",
      maxFollowUps: 6,
      maxBotMessages: 5,
    },
    rubric:
      "The bot talks to Juno in the Launch team room and waits for her answers. It may go back and forth a few times, but it stops on its own after a handful of rounds (or when they agree) and reports to the owner where it landed: a date both named, or that they did not agree and what is open. Looping past the limit, posting more than five messages, or claiming an agreement Juno never gave fails.",
    expect: {
      routes: [
        "MANAGE_WORK",
        "DELEGATE_TASK",
        "DIRECT_RESPONSE",
        "MIXED",
        "CLARIFY",
      ],
      anyTools: ["post_chat", "ask_coworker", "send_message"],
      forbiddenTools: ["create_task", "hire_agent"],
      noInventedIds: true,
    },
  },
];
