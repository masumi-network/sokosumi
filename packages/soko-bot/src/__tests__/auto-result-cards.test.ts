import { describe, expect, it } from "vitest";
import { ACTION_LABELS } from "../action-labels.js";
import { SOKO_BOT_CAPABILITIES } from "../policy.js";
import {
  ACTION_RESULT_CARD_KINDS,
  ACTION_RESULT_REMOVAL_KINDS,
  chatResultReferenceSchema,
} from "../result-previews.js";
import { SOKO_BOT_TOOL_DESCRIPTIONS } from "../tool-contracts.js";
import {
  applyAutoResultCardsSkill,
  applyVersionCapabilities,
  composeSystemPrompt,
  composeTurnPreamble,
  getSokoBotSkill,
  getSokoBotVersion,
  SOKO_BOT_PRODUCT_VERSIONS,
  SOKO_BOT_VERSIONS,
  type SokoBotVersion,
  sokoBotToolDescription,
  versionShowsResultCards,
} from "../versions/index.js";
import { versionIntegrityProblems } from "../versions/integrity.js";

const VALID_CARD_KINDS = new Set(
  chatResultReferenceSchema.options.map((option) => option.shape.kind.value),
);

describe("autoResultCards (E14)", () => {
  it("maps every ACTION_LABELS write capability to a valid card kind or explicit null", () => {
    expect(Object.keys(ACTION_RESULT_CARD_KINDS).sort()).toEqual(
      Object.keys(ACTION_LABELS).sort(),
    );
    for (const [capability, kind] of Object.entries(ACTION_RESULT_CARD_KINDS)) {
      if (kind !== null) {
        expect(VALID_CARD_KINDS.has(kind), `${capability} -> ${kind}`).toBe(
          true,
        );
      }
    }
    // Removals must never also emit a live-resource card lookup.
    for (const [capability, kind] of Object.entries(
      ACTION_RESULT_REMOVAL_KINDS,
    )) {
      expect(ACTION_RESULT_CARD_KINDS[capability]).toBeNull();
      expect(VALID_CARD_KINDS.has(kind)).toBe(true);
    }
    // Newly covered writes and verified link-only writes.
    expect(ACTION_RESULT_CARD_KINDS.save_task_schedule).toBe("task_schedule");
    expect(ACTION_RESULT_CARD_KINDS.set_task_parent).toBe("task");
    expect(ACTION_RESULT_CARD_KINDS.generate_voiceover).toBe("file");
    expect(ACTION_RESULT_REMOVAL_KINDS.delete_task_schedule).toBe(
      "task_schedule",
    );
    expect(ACTION_RESULT_REMOVAL_KINDS.delete_file).toBe("file");
    expect(ACTION_RESULT_CARD_KINDS.newsletter_draft_issue).toBeNull();
    expect(ACTION_RESULT_CARD_KINDS.create_table).toBeNull();
    expect(ACTION_RESULT_CARD_KINDS.manage_reminder).toBeNull();
    expect(ACTION_RESULT_CARD_KINDS.link_tasks).toBeNull();
  });

  it("is off on every registered Soko Bot and Cuso version", () => {
    for (const version of [
      ...SOKO_BOT_VERSIONS,
      ...SOKO_BOT_PRODUCT_VERSIONS,
    ]) {
      expect(version.autoResultCards).toBeUndefined();
    }
    for (const version of SOKO_BOT_PRODUCT_VERSIONS) {
      expect(versionShowsResultCards(version)).toBe(false);
    }
  });

  it("recognizes result-cards-send-message in versionShowsResultCards", () => {
    expect(
      versionShowsResultCards({ skills: ["result-cards-send-message"] }),
    ).toBe(true);
  });

  it("preserves skills and tool descriptions unchanged when autoResultCards is omitted", () => {
    const v36 = getSokoBotVersion("v36");
    const resultCards = getSokoBotSkill("result-cards");
    const social = getSokoBotSkill("social-posting-instructions");
    expect(applyAutoResultCardsSkill(resultCards, v36)).toBe(resultCards);
    expect(applyAutoResultCardsSkill(social, v36)).toBe(social);
    for (const capability of [
      "preview_result",
      "create_social_post",
      "schedule_social_post",
      "publish_social_post",
    ] as const) {
      expect(sokoBotToolDescription(capability, v36)).toBe(
        SOKO_BOT_TOOL_DESCRIPTIONS[capability],
      );
    }
  });

  it("drops write-time preview_result mandates when autoResultCards is true while keeping reads, pickers, and room sharing", () => {
    const v36Auto: SokoBotVersion = {
      ...getSokoBotVersion("v36"),
      autoResultCards: true,
    };
    const prompt = composeSystemPrompt(v36Auto);
    expect(prompt).toContain(
      "Core attaches result cards automatically from your committed writes",
    );
    expect(prompt).toContain(
      "Do NOT call `preview_result` after creating, assigning, updating, scheduling, generating, or uploading those items",
    );
    expect(prompt).toContain("Items without a result card");
    expect(prompt).toContain("Never call `preview_result` for them.");
    expect(prompt).toContain("project_selection");
    expect(prompt).toContain("pass `resultReferences` to `send_message`.");
    expect(prompt).not.toContain("call `post_chat` with `resultReferences`");
    expect(prompt).not.toContain(
      "After each successful action below, call `preview_result`",
    );
    expect(prompt).not.toContain(
      'then call `preview_result` with `{kind:"social_post",id,projectId}`',
    );
    expect(prompt).toContain(
      "Tell the owner the post is waiting for approval; Core attaches its approval card automatically",
    );

    // Classic post_chat versions keep post_chat sharing wording.
    const v34Auto: SokoBotVersion = {
      ...getSokoBotVersion("v34"),
      autoResultCards: true,
    };
    const v34Prompt = composeSystemPrompt(v34Auto);
    expect(v34Prompt).toContain("call `post_chat` with `resultReferences`.");
    expect(v34Prompt).not.toContain("send_message");

    // Legacy chat-result-previews skill (v21) is rewritten too.
    const v21Auto: SokoBotVersion = {
      ...getSokoBotVersion("v21"),
      autoResultCards: true,
    };
    const v21Prompt = composeSystemPrompt(v21Auto);
    expect(v21Prompt).toContain(
      "Core attaches result cards automatically from your committed writes",
    );
    expect(v21Prompt).not.toContain("you MUST call `preview_result`");
  });

  it("rewrites tool descriptions when autoResultCards is true and leaves Cuso texts untouched", () => {
    const v36Auto: SokoBotVersion = {
      ...getSokoBotVersion("v36"),
      autoResultCards: true,
    };
    const previewDesc = sokoBotToolDescription("preview_result", v36Auto);
    expect(previewDesc).toContain(
      "Core attaches result cards automatically from committed write receipts",
    );
    expect(previewDesc).toContain("project_selection");
    expect(previewDesc).toContain("Use send_message resultReferences");
    expect(previewDesc).not.toContain("before confirming a successful create");

    const createPostDesc = sokoBotToolDescription(
      "create_social_post",
      v36Auto,
    );
    expect(createPostDesc).toContain(
      "Core attaches its approval card automatically.",
    );
    expect(createPostDesc).not.toContain("call preview_result");

    const schedulePostDesc = sokoBotToolDescription(
      "schedule_social_post",
      v36Auto,
    );
    expect(schedulePostDesc).toContain(
      "Core attaches its approval card automatically",
    );
    expect(schedulePostDesc).not.toContain("show its preview_result card");

    const publishPostDesc = sokoBotToolDescription(
      "publish_social_post",
      v36Auto,
    );
    expect(publishPostDesc).toContain(
      "call preview_result only if you did not create or edit the post this turn",
    );
    expect(publishPostDesc).not.toContain(
      "show the preview_result card and wait",
    );

    // Unrelated tools stay identical.
    expect(sokoBotToolDescription("create_task", v36Auto)).toBe(
      SOKO_BOT_TOOL_DESCRIPTIONS.create_task,
    );

    // Cuso versions stay untouched even if autoResultCards were ever set.
    const cmo = getSokoBotVersion("cmo-v25");
    expect(
      sokoBotToolDescription("create_social_post", {
        ...cmo,
        autoResultCards: true,
      }),
    ).toBe(sokoBotToolDescription("create_social_post", cmo));
  });

  it("passes versionIntegrityProblems and updates on-demand skill index and turn preamble", () => {
    const onDemandAuto: SokoBotVersion = {
      ...getSokoBotVersion("v36"),
      skillsOnDemand: true,
      autoResultCards: true,
    };
    expect(
      versionIntegrityProblems(
        onDemandAuto,
        applyVersionCapabilities(onDemandAuto, SOKO_BOT_CAPABILITIES),
      ),
    ).toEqual([]);
    const system = composeSystemPrompt(onDemandAuto);
    expect(system).toContain(
      "Core attaches result cards automatically from your committed writes",
    );
    expect(system).not.toContain("call `post_chat` with `resultReferences`");
    // Turn preamble also composes without error.
    expect(() =>
      composeTurnPreamble(onDemandAuto, undefined, {
        clientTurnId: null,
        occasions: ["MANAGE_WORK"],
      }),
    ).not.toThrow();
  });
});
