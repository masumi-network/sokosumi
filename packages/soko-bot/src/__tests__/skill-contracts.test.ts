import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ACTION_LABELS } from "../action-labels.js";
import {
  ACTION_RESULT_CARD_KINDS,
  CHAT_RESULT_REFERENCE_KINDS,
  chatResultReferenceSchema,
} from "../result-previews.js";
import { SOKO_BOT_TOOL_DESCRIPTIONS } from "../tool-contracts.js";
import {
  getSokoBotVersion,
  SOKO_BOT_PRODUCT_VERSIONS,
  SOKO_BOT_VERSIONS,
} from "../versions/index.js";
import {
  allContractSources,
  checkActionCardMapping,
  checkCardAndFieldReferences,
  checkUniversalRuleContracts,
  checkUnknownToolNames,
  checkVersionToolReferences,
  evaluateContractFindings,
  KNOWN_LIVE_CONTRACT_DRIFT,
} from "../versions/skill-contracts.js";

const ALL_VERSIONS = [...SOKO_BOT_VERSIONS, ...SOKO_BOT_PRODUCT_VERSIONS];

describe("skill and tool contract self-consistency (B4 / R5-B)", () => {
  it("locks CHAT_RESULT_REFERENCE_KINDS to chatResultReferenceSchema", () => {
    const schemaKinds = chatResultReferenceSchema.options
      .map((option) => option.shape.kind.value)
      .sort();
    expect([...CHAT_RESULT_REFERENCE_KINDS].sort()).toEqual(schemaKinds);
  });

  it("has zero unexpected drift across checks 1-4 and zero stale allowlist entries", () => {
    const sources = allContractSources(ALL_VERSIONS);
    const findings = [
      ...checkUnknownToolNames(sources),
      ...checkVersionToolReferences(ALL_VERSIONS),
      ...checkCardAndFieldReferences(sources),
      ...checkActionCardMapping(ACTION_LABELS, ACTION_RESULT_CARD_KINDS),
      ...checkUniversalRuleContracts(ALL_VERSIONS),
    ];

    const { unexpected, staleAllowlist } = evaluateContractFindings(
      findings,
      KNOWN_LIVE_CONTRACT_DRIFT,
    );

    expect(
      unexpected.map((f) => `${f.key}: ${f.message}`),
      "Unexpected skill/schema contract drift found",
    ).toEqual([]);
    expect(
      staleAllowlist,
      "Remove fixed entries from KNOWN_LIVE_CONTRACT_DRIFT",
    ).toEqual([]);
  });

  it("Check 1a catches unknown backticked, curl, and scripted tool names", () => {
    const findings = checkUnknownToolNames([
      {
        label: "skill:fake",
        content: [
          "Call `create_nonexistent_thing` first.",
          'curl "$SOKO_TOOLS_URL/delete_imaginary_item"',
          'await call("fetch_missing_tool", {})',
        ].join("\n"),
      },
    ]);
    expect(findings.map((f) => f.key)).toEqual([
      "check1a:skill:fake:create_nonexistent_thing",
      "check1a:skill:fake:delete_imaginary_item",
      "check1a:skill:fake:fetch_missing_tool",
    ]);
  });

  it("Check 1b catches a registered tool named in a live version that is not offered to it", () => {
    const v36 = getSokoBotVersion("v36");
    const broken = {
      ...v36,
      systemPrompt: `${v36.systemPrompt}\nUse \`open_direct_chat\` to message teammates.`,
    };
    const findings = checkVersionToolReferences([broken]);
    expect(findings.map((f) => f.key)).toContain(
      "check1b:v36:systemPrompt:open_direct_chat",
    );
  });

  it("Check 2a catches unknown card kinds and missing/extra card fields", () => {
    const findings = checkCardAndFieldReferences([
      {
        label: "skill:cards-drift",
        content: [
          'Newsletter card: `{kind:"newsletter_issue",id}`.',
          'Social post missing projectId: `{kind:"social_post",id}`.',
          'Task with invented field: `{kind:"task",id,status}`.',
          'Bad JSON example: preview_result({"reference":{"kind":"task","id":"t1","href":"/tasks/t1"}})',
        ].join("\n"),
      },
    ]);
    expect(findings.map((f) => f.key)).toEqual([
      "check2a:skill:cards-drift:unknown-kind:newsletter_issue",
      "check2a:skill:cards-drift:kind-fields:social_post:projectId:",
      "check2a:skill:cards-drift:kind-fields:task::status",
      "check2a:skill:cards-drift:kind-fields:task::href",
      'check2a:skill:cards-drift:preview-json-invalid:{"reference":{"kind":"task","id":"t1","href":"/tasks/t1"}}',
    ]);
  });

  it("Check 2b catches unknown tool input fields and invalid enum literals in examples", () => {
    const findings = checkCardAndFieldReferences([
      {
        label: "skill:fields-drift",
        content: [
          'create_task({"name":"x","bogusField":true})',
          'curl -s "$SOKO_TOOLS_URL/search_inbox" -d \'{"input":{"provider":"gmail","wrongParam":1}}\'',
          "Call `wait_for` (`kind: imaginary_kind`) or `create_task` with `nonexistentArg`.",
        ].join("\n"),
      },
    ]);
    expect(findings.map((f) => f.key)).toEqual([
      "check2b:skill:fields-drift:call:create_task:bogusField",
      "check2b:skill:fields-drift:curl:search_inbox:wrongParam",
      "check2b:skill:fields-drift:enum:wait_for:kind:imaginary_kind",
      "check2b:skill:fields-drift:with:create_task:nonexistentArg",
    ]);
  });

  it("Check 3 catches an ACTION_LABELS write missing a card kind or no_card reason", () => {
    const findings = checkActionCardMapping(
      {
        create_task: "Created task",
        create_newsletter_issue: "Created newsletter draft",
      },
      {
        create_newsletter_issue: { kind: "no_card", reason: "   " },
      },
    );
    expect(findings.map((f) => f.key)).toEqual([
      "check3:missing-card-mapping:create_task",
      "check3:empty-no-card-reason:create_newsletter_issue",
    ]);
  });

  it("Check 4 catches universal-rule regressions", () => {
    const v36 = getSokoBotVersion("v36");
    const cmoV24 = getSokoBotVersion("cmo-v24");
    const findings = checkUniversalRuleContracts([v36, cmoV24], {
      skills: [
        {
          id: "result-cards",
          content: "Call `preview_result` for every created item.",
        },
        {
          id: "cmo-launch-video",
          content: "Show its preview card after creating the post.",
        },
      ],
      toolDescriptions: {
        ...SOKO_BOT_TOOL_DESCRIPTIONS,
        preview_result: "Prepare a card after every create.",
        generate_image: "Generate an image.",
      },
      generateImageSchema: z.object({ prompt: z.string() }),
    });
    expect(findings.map((f) => f.key)).toEqual([
      "check4:result-cards-no-card-boundary:skill:result-cards",
      "check4:result-cards-no-card-boundary:desc:preview_result",
      "check4:cuso-no-preview-card:skill:cmo-launch-video",
      "check4:generate-image-constraints-exposed:schema:generate_image",
    ]);
  });
});
