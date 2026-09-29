import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  applyVersionCapabilities,
  capabilitiesForClassification,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
  isSokoBotDecisionTarget,
  SOKO_BOT_BOT_TO_BOT_CAPABILITIES,
  SOKO_BOT_ROUTE_CAPABILITIES,
  SOKO_BOT_ROUTES,
  SOKO_BOT_TEAMMATE_CAPABILITIES,
  SOKO_BOT_TOOL_DESCRIPTIONS,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  SOKO_BOT_WEB_TAINTED_BLOCKED_CAPABILITIES,
  type TurnClassification,
} from "../index.js";

const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const postId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const socialConnectionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const scheduledAt = "2026-10-01T12:00:00+02:00";
const media = {
  pathname: "drive/users/owner/launch.png",
  fileUrl: "https://store.public.blob.vercel-storage.com/launch.png",
  name: "launch.png",
  size: 240000,
  mimeType: "image/png",
  kind: "image",
};
const reads = [
  "list_project_social_accounts",
  "list_social_posts",
  "get_social_post",
] as const;
const writes = [
  "create_social_post",
  "update_social_post",
  "schedule_social_post",
  "cancel_social_post",
  "publish_social_post",
] as const;
const schemas = SOKO_BOT_TOOL_INPUT_SCHEMAS;
const inputs = {
  list_project_social_accounts: { projectId },
  list_social_posts: { projectId },
  get_social_post: { projectId, postId },
  create_social_post: { projectId, text: "Launch" },
  update_social_post: { projectId, postId, revision: 0, text: "Launch" },
  schedule_social_post: { projectId, postId, revision: 0, scheduledAt },
  cancel_social_post: { projectId, postId, revision: 0 },
  publish_social_post: { projectId, postId, revision: 0 },
};

function classification(
  writeScope?: TurnClassification["writeScope"],
): TurnClassification {
  return {
    route: "MANAGE_WORK",
    writeScope,
    schemaVersion: 1,
    confidence: 1,
    rationaleSummary: "Owner request",
    requestedOutcome: "Manage project posts",
    candidateProjectIds: [projectId],
    candidateCoworkerIds: [],
    candidateAgentIds: [],
    requiresClarification: false,
    requiresApproval: false,
  };
}

describe("Social tool contracts", () => {
  it.each([...reads, ...writes])(
    "%s accepts its intended input but rejects scope and actor overrides",
    (capability) => {
      const schema = schemas[capability];
      const input = inputs[capability];
      expect(schema.safeParse(input).success).toBe(true);
      expect(schema.safeParse({ ...input, projectId: "invalid" }).success).toBe(
        false,
      );
      for (const field of [
        "workspaceId",
        "organizationId",
        "actor",
        "userId",
        "coworkerId",
        "sokoBotId",
        "provider",
      ]) {
        expect(
          schema.safeParse({ ...input, [field]: "override" }).success,
        ).toBe(false);
      }
      const json = z.toJSONSchema(schema);
      expect(json.type).toBe("object");
      expect(json.additionalProperties).toBe(false);
    },
  );

  it("bounds pagination and accepts all seven states", () => {
    expect(schemas.list_social_posts.parse({ projectId })).toEqual({
      projectId,
      limit: 20,
    });
    expect(
      schemas.list_social_posts.safeParse({
        projectId,
        cursor: postId,
        limit: 100,
        statuses: [
          "DRAFT",
          "SCHEDULED",
          "PUBLISHING",
          "PUBLISHED",
          "FAILED",
          "MISSED",
          "CANCELED",
        ],
      }).success,
    ).toBe(true);
    for (const patch of [
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { cursor: "invalid" },
      { statuses: [] },
      { statuses: ["UNKNOWN"] },
      { statuses: "DRAFT,SCHEDULED" },
    ]) {
      expect(
        schemas.list_social_posts.safeParse({ projectId, ...patch }).success,
      ).toBe(false);
    }
  });

  it("describes every provider's publishing rules", () => {
    const descriptions = SOKO_BOT_TOOL_DESCRIPTIONS;
    const socialKeys = [
      "list_project_social_accounts",
      "list_social_posts",
      "get_social_post",
      "create_social_post",
      "update_social_post",
      "schedule_social_post",
      "cancel_social_post",
      "publish_social_post",
    ] as const;
    for (const key of socialKeys) {
      expect(descriptions[key]).not.toMatch(/X only/);
    }
    expect(descriptions.list_project_social_accounts).toMatch(/Instagram/);
    expect(descriptions.create_social_post).toMatch(/video/);
    expect(descriptions.create_social_post).toMatch(/LinkedIn/);
  });

  it("requires text or media for creation and preserves partial updates", () => {
    expect(
      schemas.create_social_post.parse({ projectId, text: "  Launch  " }).text,
    ).toBe("Launch");
    expect(
      schemas.create_social_post.safeParse({ projectId, text: " " }).success,
    ).toBe(false);
    expect(
      schemas.create_social_post.safeParse({
        projectId,
        text: "x".repeat(3000),
      }).success,
    ).toBe(true);
    expect(
      schemas.create_social_post.safeParse({
        projectId,
        text: "x".repeat(63207),
      }).success,
    ).toBe(false);
    expect(
      schemas.create_social_post.safeParse({
        projectId,
        text: "",
        media: [media],
      }).success,
    ).toBe(true);
    expect(
      schemas.create_social_post.safeParse({
        projectId,
        text: "",
        media: Array.from({ length: 5 }, () => media),
      }).success,
    ).toBe(false);
    expect(
      schemas.update_social_post.safeParse({
        projectId,
        postId,
        revision: 0,
        text: "",
        socialConnectionId: null,
      }).success,
    ).toBe(true);
  });

  it.each(["create_social_post", "schedule_social_post"] as const)(
    "%s accepts explicit offsets and validates timezones and accounts",
    (capability) => {
      const input = {
        ...inputs[capability],
        scheduledAt,
        timezone: "Europe/Prague",
        socialConnectionId,
      };
      expect(schemas[capability].safeParse(input).success).toBe(true);
      for (const patch of [
        { scheduledAt: "tomorrow" },
        { scheduledAt: "2026-10-01T12:00:00" },
        { timezone: "Invalid/Timezone" },
        { socialConnectionId: "invalid" },
      ]) {
        expect(
          schemas[capability].safeParse({ ...input, ...patch }).success,
        ).toBe(false);
      }
    },
  );

  it.each(writes.filter((capability) => capability !== "create_social_post"))(
    "%s requires an observed revision and valid post id",
    (capability) => {
      const { revision: _revision, ...input } = inputs[capability];
      expect(schemas[capability].safeParse(input).success).toBe(false);
      for (const revision of [-1, 0.5, "0"]) {
        expect(
          schemas[capability].safeParse({ ...input, revision }).success,
        ).toBe(false);
      }
      expect(
        schemas[capability].safeParse({
          ...input,
          revision: 0,
          postId: "invalid",
        }).success,
      ).toBe(false);
    },
  );
});

describe("Social capability ceilings", () => {
  it("grants reads on every owner route and writes only on SOCIAL or WORK", () => {
    for (const route of SOKO_BOT_ROUTES) {
      for (const read of reads) {
        expect(SOKO_BOT_ROUTE_CAPABILITIES[route]).toContain(read);
      }
      if (route !== "MANAGE_WORK") {
        for (const write of writes) {
          expect(SOKO_BOT_ROUTE_CAPABILITIES[route]).not.toContain(write);
        }
      }
    }
    for (const scope of ["SOCIAL", "WORK"] as const) {
      const granted = capabilitiesForClassification(classification(scope));
      for (const write of writes) expect(granted).toContain(write);
    }
    for (const scope of [
      undefined,
      "MEMORY",
      "SCHEDULE",
      "CHAT",
      "FILE",
      "INTEGRATION",
    ] as const) {
      const granted = capabilitiesForClassification(classification(scope));
      for (const write of writes) expect(granted).not.toContain(write);
    }
    const social = capabilitiesForClassification(classification("SOCIAL"));
    for (const unrelated of [
      "create_task",
      "hire_agent",
      "run_integration_tool",
      "create_schedule",
      "request_user_decision",
    ]) {
      expect(social).not.toContain(unrelated);
    }
  });

  it("keeps every social capability off teammate and bot-to-bot ceilings", () => {
    for (const ceiling of [
      SOKO_BOT_TEAMMATE_CAPABILITIES,
      SOKO_BOT_BOT_TO_BOT_CAPABILITIES,
    ]) {
      for (const capability of [...reads, ...writes]) {
        expect(ceiling).not.toContain(capability);
      }
    }
  });

  it("blocks every social mutation after untrusted web or shell input", () => {
    for (const write of writes) {
      expect(SOKO_BOT_WEB_TAINTED_BLOCKED_CAPABILITIES).toContain(write);
      expect(isSokoBotDecisionTarget(write)).toBe(false);
    }
    for (const read of reads) {
      expect(SOKO_BOT_WEB_TAINTED_BLOCKED_CAPABILITIES).not.toContain(read);
    }
  });

  it("exposes social tools through the current version without widening ceilings", () => {
    const version = getSokoBotVersion(DEFAULT_SOKO_BOT_VERSION_ID);
    const social = capabilitiesForClassification(classification("SOCIAL"));
    expect(applyVersionCapabilities(version, social)).toEqual(social);
    expect(
      applyVersionCapabilities(
        { ...version, capabilities: [...reads, ...writes] },
        SOKO_BOT_TEAMMATE_CAPABILITIES,
      ),
    ).toEqual([]);
  });
});
