import { describe, expect, it } from "vitest";
import { SOKO_BOT_CAPABILITIES } from "../policy.js";
import {
  applyE1Skill,
  applyE1SystemPrompt,
  E1_CUSO_CHANGE_SCOPE_SECTION,
  E1_FINISHING_SECTION,
} from "../versions/e1-prompts.js";
import {
  applyVersionCapabilities,
  composeSystemPrompt,
  composeTurnPreamble,
  getSokoBotSkillForVersion,
  getSokoBotVersion,
} from "../versions/index.js";
import { versionIntegrityProblems } from "../versions/integrity.js";

describe("e1Prompts version flag", () => {
  it("leaves flag-off Soko Bot and Cuso versions byte-identical", () => {
    const v36 = getSokoBotVersion("v36");
    const cmo = getSokoBotVersion("cmo-v24");
    expect(v36.e1Prompts).toBeUndefined();
    expect(cmo.e1Prompts).toBeUndefined();
    expect(applyE1SystemPrompt(v36.systemPrompt, v36)).toBe(
      v36.systemPrompt.trim(),
    );
    expect(applyE1SystemPrompt(cmo.systemPrompt, cmo)).toBe(
      cmo.systemPrompt.trim(),
    );
    expect(
      getSokoBotSkillForVersion("long-and-chained-work-follow-ups", v36)
        .content,
    ).toContain("sleep 120");
    expect(composeSystemPrompt(v36)).not.toContain("# Finishing the request");
    expect(composeSystemPrompt(cmo)).not.toContain(
      "# Applying requested changes",
    );
  });

  it("applies finishing checklist, durable wakes, scheduledAt clarity, and tighter index on Soko Bot without leaking CMO rules", () => {
    const base = getSokoBotVersion("v36");
    const e1 = {
      ...base,
      skillsOnDemand: true as const,
      e1Prompts: true as const,
    };
    const prompt = composeSystemPrompt(e1);
    expect(prompt).toContain(E1_FINISHING_SECTION);
    expect(prompt).toContain(
      "updating existing or upcoming items only within the scope the owner asked for",
    );
    expect(prompt).not.toContain("nothing needs approval in the product");
    expect(prompt).toContain(
      "never report a pending draft or proposal as scheduled or live",
    );
    expect(prompt).not.toContain("pick the likeliest room or person yourself");
    expect(prompt).toContain(
      "name the matching options when destination is open",
    );
    expect(prompt).toContain(
      "especially when (date, time, or time zone) or which account, recipient, or audience (target)",
    );
    expect(prompt).not.toContain(
      "When a schedule's purpose is done, `delete_schedule` it",
    );
    expect(prompt).toContain(
      "Delete a recurring schedule only when the owner explicitly asks to stop or remove it",
    );
    expect(prompt).toContain("keepCapabilities: true");
    expect(prompt).toContain(
      "still create the requested draft attributed to that report and state plainly what was not independently verified",
    );
    expect(prompt).toContain(
      "Never answer `Nothing to add.` to a human's chat message.",
    );
    expect(prompt).toContain(
      "call `update_plan` up front to list every requested deliverable and constraint before executing",
    );
    expect(prompt).not.toContain(E1_CUSO_CHANGE_SCOPE_SECTION);
    expect(prompt).toContain(
      "Your owner's mail, calendar, files, memory, pending decisions, and costs are theirs to share",
    );
    expect(prompt).toContain(
      "not for read-only lookups, audits, or single-turn edits",
    );

    const chained = getSokoBotSkillForVersion(
      "long-and-chained-work-follow-ups",
      e1,
    );
    expect(chained.content).not.toContain("sleep 120");
    expect(chained.content).toContain("durable wakes");

    const social = getSokoBotSkillForVersion("social-posting-instructions", e1);
    expect(social.content).toContain("intended publication date or time");
    expect(social.content).toContain(
      "explicitly asks you to pick a publication slot and schedule it",
    );
    expect(social.content).toContain(
      "Never put a review deadline or unrequested suggested date into `scheduledAt`",
    );
    expect(social.content).toContain("unscheduled proposals");
    expect(social.content).toContain("never SVG — social platforms reject SVG");

    const resultCards = getSokoBotSkillForVersion("result-cards", e1);
    expect(resultCards.content).not.toContain(
      "(also before Content Studio generation)",
    );
    expect(resultCards.content).toContain(
      "When one project clearly fits the request",
    );
    expect(getSokoBotSkillForVersion("result-cards", base).content).toContain(
      "(also before Content Studio generation)",
    );

    const preamble = composeTurnPreamble(e1, undefined, {
      clientTurnId: null,
      occasions: ["MIXED"],
    });
    expect(preamble).not.toContain("sleep 120");
    expect(preamble).toContain("durable wakes");

    expect(
      versionIntegrityProblems(
        { ...base, e1Prompts: true },
        applyVersionCapabilities(base, SOKO_BOT_CAPABILITIES),
      ),
    ).toEqual([]);
    const onDemandValid = {
      ...e1,
      skills: e1.skills.filter((id) => id !== "result-cards"),
    };
    expect(
      versionIntegrityProblems(
        onDemandValid,
        applyVersionCapabilities(onDemandValid, SOKO_BOT_CAPABILITIES),
      ),
    ).toEqual([]);
  });

  it("replaces personal-assistant TEAMMATE refusal and adds strategy-and-posts scope on Cuso with prompt-cache invariance", () => {
    const base = getSokoBotVersion("cmo-v24");
    const e1 = { ...base, e1Prompts: true as const };

    const promptA = composeSystemPrompt(e1, { name: "Cuso" } as never, {
      clientTurnId: null,
      occasions: ["chat"],
    });
    const promptB = composeSystemPrompt(
      e1,
      { name: "Other", shared: true } as never,
      {
        clientTurnId: "cmo:production:1",
        occasions: ["production"],
      },
    );
    expect(promptA).toBe(promptB);
    expect(promptA).toContain(E1_FINISHING_SECTION);
    expect(promptA).toContain(E1_CUSO_CHANGE_SCOPE_SECTION);
    expect(promptA).not.toContain("nothing needs approval in the product");
    expect(promptA).not.toContain("pick the likeliest room or person yourself");
    expect(promptA).not.toContain("and the strategy is updated to match.");
    expect(promptA).toContain(
      "on the affected post(s); update the stored strategy too only when the owner explicitly asks",
    );
    expect(promptA).toContain(
      "When tool receipts confirm every requested change took effect and the card says it all",
    );
    expect(promptA).toContain(
      "never silently drop a deliverable or constraint the owner explicitly asked for",
    );
    expect(promptA).toContain(
      "if X is already running, watch the existing Task, Job, or Studio job ID with `wait_for` (never create or hire a duplicate)",
    );
    expect(promptA).toContain(
      "only when X is new, authorized work, create or hire it once with `followUp`",
    );
    expect(promptA).toContain(
      "Delete a recurring schedule only when the owner explicitly asks to stop or remove it.",
    );
    expect(promptA).toContain("keepCapabilities: true");
    expect(promptA).toContain(
      "Never answer `Nothing to add.` to a human's chat message.",
    );
    expect(promptA).not.toContain("- Plan first, ask later.");
    expect(promptA).toContain(
      "Never invent scope, cadence, or channel targets for an open-ended or ambiguous request",
    );
    expect(promptA).toContain("Single-post edits stay on that post.");
    expect(promptA).toContain(
      "within any item or date limits the owner stated",
    );
    expect(promptA).toContain("Proposals stay pending.");
    expect(promptA).toContain(
      "You are a shared Project assistant, not a private personal assistant.",
    );
    expect(promptA).not.toContain(
      "Your owner's mail, calendar, files, memory, pending decisions, and costs are theirs to share",
    );
    expect(
      versionIntegrityProblems(
        e1,
        applyVersionCapabilities(e1, SOKO_BOT_CAPABILITIES),
      ),
    ).toEqual([]);
  });

  it("removes schedule-scope and Cuso write_strategy contradictions from v40/cmo-v27 skills only when e1Prompts is on", () => {
    const off = { e1Prompts: undefined } as const;
    const on = { e1Prompts: true as const };

    const contextOnDemand = {
      id: "context-on-demand",
      name: "What you see and what you read",
      description: "Map",
      content:
        "- Schedules: list_schedules; scope workspace adds the workspace's Task Schedules and other bots' schedules, each with who made it and how it last ran.",
    };
    expect(applyE1Skill(contextOnDemand, off)).toBe(contextOnDemand);
    const contextOn = applyE1Skill(contextOnDemand, on);
    expect(contextOn.content).not.toContain("and other bots' schedules");
    expect(contextOn.content).toContain(
      "other members' personal bots are private and not visible",
    );

    const coreWritesStrategy = {
      id: "cmo-core-writes-strategy",
      name: "Core writes the strategy",
      description: "Strategy",
      content:
        "- When the owner asks to change the strategy (a network, how often it posts, a pillar, the offer, the ads, an example post), call write_strategy with change: the owner's request in their own words, plus anything from the chat it needs. Core changes only what the request touches. Its answer says what changed (toOwner); then do the rest of what the owner asked in the same turn.",
    };
    expect(applyE1Skill(coreWritesStrategy, off)).toBe(coreWritesStrategy);
    const strategyOn = applyE1Skill(coreWritesStrategy, on);
    expect(strategyOn.content).not.toContain("an example post");
    expect(strategyOn.content).toContain("update any affected upcoming posts");
    expect(strategyOn.content).toContain(
      "For edits to specific posts only, use the post tools directly",
    );
    // cmo-core-writes-strategy is also carried on Cuso production turns, which
    // offer update_social_posts but not create_social_post or cancel_social_post.
    expect(strategyOn.content).not.toContain("create_social_post");
    expect(strategyOn.content).not.toContain("cancel_social_post");
    expect(strategyOn.content).toContain("update_social_posts");

    const asksBeforeChange = {
      id: "cmo-asks-before-strategy-change",
      name: "Ask before changing the strategy",
      description: "Ask",
      content: `# Ask before changing the strategy

Change the strategy only as far as the owner has said what to change.
- Do every part of the request that is clear in this turn, with write_strategy as usual.
- A part that leaves the change for you to guess (more, better or different without saying what or how much, or whether something is possible) is a question: answer it, ask one question about that part only, offering your best guess, and leave that part as it is until they reply.`,
    };
    expect(applyE1Skill(asksBeforeChange, off)).toBe(asksBeforeChange);
    const asksOn = applyE1Skill(asksBeforeChange, on);
    expect(asksOn.content).not.toContain("with write_strategy as usual");
    expect(asksOn.content).toContain(
      "edit, create, or cancel specific posts directly",
    );
    expect(asksOn.content).toContain(
      "act without adding extra confirmation questions",
    );

    const resultCardsSendMsg = {
      id: "result-cards-send-message",
      name: "Chat result previews",
      description: "Cards",
      content:
        'When the owner must choose a project (also before Content Studio generation), show a selector rather than asking them to type a name: preview_result with `{kind:"project_selection",projectIds:[...]}` holding up to 12 real projects from context or `refresh_context` (more: ask for a search term), then a short question. Selecting is not approval to publish or spend.',
    };
    expect(applyE1Skill(resultCardsSendMsg, off)).toBe(resultCardsSendMsg);
    const cardsOn = applyE1Skill(resultCardsSendMsg, on);
    expect(cardsOn.content).not.toContain(
      "(also before Content Studio generation)",
    );
    expect(cardsOn.content).toContain(
      "Only when two or more unrelated projects genuinely fit",
    );
  });
});
