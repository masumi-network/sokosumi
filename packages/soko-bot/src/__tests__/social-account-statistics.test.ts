import { describe, expect, it } from "vitest";
import {
  composeSystemPrompt,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
  SOKO_BOT_BOT_TO_BOT_CAPABILITIES,
  SOKO_BOT_ROUTE_CAPABILITIES,
  SOKO_BOT_ROUTES,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
} from "../index.js";

const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const connectionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("account-wide Social statistics", () => {
  it("exposes cached account reads and history synchronization only to owner routes", () => {
    for (const capability of [
      "list_social_account_statistics",
      "refresh_social_account_statistics",
      "list_social_performance",
      "read_social_performance_audience",
      "read_social_performance_benchmark",
      "read_social_performance_discovery",
    ] as const) {
      for (const route of SOKO_BOT_ROUTES) {
        expect(SOKO_BOT_ROUTE_CAPABILITIES[route]).toContain(capability);
      }
      expect(SOKO_BOT_BOT_TO_BOT_CAPABILITIES).not.toContain(capability);
    }
  });
  it("validates scoped audience post selection and bounded public handles", () => {
    expect(
      SOKO_BOT_TOOL_INPUT_SCHEMAS.read_social_performance_audience.safeParse({
        projectId,
        connectionId,
        kind: "likers",
      }).success,
    ).toBe(false);
    expect(
      SOKO_BOT_TOOL_INPUT_SCHEMAS.read_social_performance_audience.parse({
        projectId,
        connectionId,
        kind: "mentions",
      }),
    ).toEqual({ projectId, connectionId, kind: "mentions", limit: 20 });
    expect(
      SOKO_BOT_TOOL_INPUT_SCHEMAS.read_social_performance_benchmark.safeParse({
        projectId,
        connectionId,
        username: "https://example.com",
      }).success,
    ).toBe(false);
  });
  it("requires a constrained discovery query and rejects inverted audience thresholds", () => {
    const schema =
      SOKO_BOT_TOOL_INPUT_SCHEMAS.read_social_performance_discovery;
    expect(schema.safeParse({ projectId, connectionId }).success).toBe(false);
    expect(
      schema.safeParse({
        projectId,
        connectionId,
        topic: "safe OR from:someone",
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        projectId,
        connectionId,
        topic: "AI",
        minFollowers: 100,
        maxFollowers: 20,
      }).success,
    ).toBe(false);
    expect(
      schema.parse({ projectId, connectionId, topic: "AI agents" }),
    ).toMatchObject({ limit: 20, format: "any", sort: "recency" });
  });

  it("supports current-workspace performance without allowing model-supplied workspace identity", () => {
    const schema = SOKO_BOT_TOOL_INPUT_SCHEMAS.list_social_performance;
    expect(schema.parse({ provider: "x" })).toMatchObject({
      provider: "x",
      limit: 20,
    });
    expect(schema.safeParse({ workspaceId: projectId }).success).toBe(false);
    expect(schema.parse({ projectId })).toMatchObject({ projectId });
  });
  it("validates account filters and lets history continue without a caller-supplied cursor", () => {
    const schemas = SOKO_BOT_TOOL_INPUT_SCHEMAS;
    expect(
      schemas.list_social_account_statistics.parse({ projectId, connectionId }),
    ).toEqual({ projectId, connectionId, limit: 20 });
    expect(
      schemas.refresh_social_account_statistics.parse({
        projectId,
        connectionId,
        continueHistory: true,
      }),
    ).toEqual({ projectId, connectionId, continueHistory: true });
    expect(
      schemas.refresh_social_account_statistics.safeParse({
        projectId,
        connectionId,
        cursor: "https://untrusted.example/posts",
      }).success,
    ).toBe(false);
    expect(
      schemas.list_social_account_statistics.safeParse({
        projectId,
        connectionId: "invalid",
      }).success,
    ).toBe(false);
  });

  it("teaches the new default to evaluate externally published posts without changing v22", () => {
    const version = getSokoBotVersion(DEFAULT_SOKO_BOT_VERSION_ID);
    const prior = getSokoBotVersion("v22");
    expect(DEFAULT_SOKO_BOT_VERSION_ID).toBe("v24");
    expect(version.model).toBe(prior.model);
    expect(version.systemPrompt).toBe(prior.systemPrompt);
    const prompt = composeSystemPrompt(version);
    expect(prompt).toContain("list_social_account_statistics");
    expect(prompt).toContain("continueHistory");
    expect(prompt).toContain("outside Sokosumi");
    expect(prompt).toContain("historyComplete");
    expect(prompt).toContain("metric period");
    expect(prompt).toContain("do not stop history pagination");
    expect(prompt).not.toContain("# Chat result previews");
    expect(composeSystemPrompt(prior)).not.toContain(
      "# Social account performance",
    );
  });
});
