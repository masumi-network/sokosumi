import { describe, expect, it } from "vitest";
import {
  composeSystemPrompt,
  DEFAULT_SOKO_BOT_VERSION_ID,
  getSokoBotVersion,
  limitSokoBotWrites,
  SOKO_BOT_BOT_TO_BOT_CAPABILITIES,
  SOKO_BOT_ROUTE_CAPABILITIES,
  SOKO_BOT_ROUTES,
  SOKO_BOT_TOOL_INPUT_SCHEMAS,
  SOKO_BOT_VERSIONS,
} from "../index.js";

const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const connectionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const postId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("Social performance insights", () => {
  it("exposes the performance alias and X research reads only to owner routes", () => {
    for (const capability of [
      "list_social_performance",
      "read_social_performance_audience",
      "read_social_performance_benchmark",
      "read_social_performance_discovery",
    ] as const) {
      for (const route of SOKO_BOT_ROUTES) {
        expect(SOKO_BOT_ROUTE_CAPABILITIES[route]).toContain(capability);
      }
      expect(SOKO_BOT_BOT_TO_BOT_CAPABILITIES).not.toContain(capability);
      expect(limitSokoBotWrites([capability], [])).toContain(capability);
    }
  });

  it("keeps the performance alias on the same filters as account statistics", () => {
    const schema = SOKO_BOT_TOOL_INPUT_SCHEMAS.list_social_performance;
    expect(schema.parse({ projectId, connectionId })).toEqual({
      projectId,
      connectionId,
      limit: 20,
    });
    expect(schema.safeParse({ connectionId }).success).toBe(false);
    expect(
      schema.safeParse({
        projectId,
        provider: "x",
        publishedFrom: "2026-10-01T00:00:00Z",
        publishedUntil: "2026-10-08T00:00:00Z",
        cursor: postId,
        limit: 5,
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        projectId,
        contentType: "video",
        postKind: "posts",
        timezone: "UTC",
      }).success,
    ).toBe(false);
  });

  it("requires a cached post only for likers and reposters", () => {
    const schema = SOKO_BOT_TOOL_INPUT_SCHEMAS.read_social_performance_audience;
    expect(schema.parse({ projectId, connectionId })).toEqual({
      projectId,
      connectionId,
      kind: "mentions",
      limit: 20,
    });
    expect(
      schema.safeParse({
        projectId,
        connectionId,
        kind: "likers",
      }).success,
    ).toBe(false);
    expect(
      schema.parse({
        projectId,
        connectionId,
        kind: "reposters",
        postId,
      }),
    ).toEqual({
      projectId,
      connectionId,
      kind: "reposters",
      postId,
      limit: 20,
    });
  });

  it("validates public X handles and discovery bounds", () => {
    expect(
      SOKO_BOT_TOOL_INPUT_SCHEMAS.read_social_performance_benchmark.parse({
        projectId,
        connectionId,
        username: "Launch_1",
      }),
    ).toEqual({
      projectId,
      connectionId,
      username: "Launch_1",
    });
    expect(
      SOKO_BOT_TOOL_INPUT_SCHEMAS.read_social_performance_benchmark.safeParse({
        projectId,
        connectionId,
        username: "https://evil",
      }).success,
    ).toBe(false);
    const discovery =
      SOKO_BOT_TOOL_INPUT_SCHEMAS.read_social_performance_discovery;
    expect(
      discovery.parse({ projectId, connectionId, topic: "launch" }),
    ).toEqual({
      projectId,
      connectionId,
      topic: "launch",
      format: "any",
      limit: 20,
      sort: "recency",
    });
    expect(discovery.safeParse({ projectId, connectionId }).success).toBe(
      false,
    );
    expect(
      discovery.safeParse({
        projectId,
        connectionId,
        topic: "launch OR from:evil",
      }).success,
    ).toBe(false);
    expect(
      discovery.safeParse({
        projectId,
        connectionId,
        topic: "launch",
        minFollowers: 100,
        maxFollowers: 10,
      }).success,
    ).toBe(false);
  });

  it("adds X research to v31 while retaining coding, follow-up plans and result previews", () => {
    const version = getSokoBotVersion(DEFAULT_SOKO_BOT_VERSION_ID);
    const prior = getSokoBotVersion("v31");
    expect(DEFAULT_SOKO_BOT_VERSION_ID).toBe("v32");
    expect(version.model).toBe(prior.model);
    expect(version.systemPrompt).toBe(prior.systemPrompt);
    expect(version.capabilities).toBe(prior.capabilities);
    expect(version.skills).toEqual([
      ...prior.skills,
      "social-performance-insights",
    ]);
    expect(version.createdAt).toBe("2026-10-26");
    const prompt = composeSystemPrompt(version);
    expect(prompt).toContain("list_social_performance");
    expect(prompt).toContain("read_social_performance_audience");
    expect(prompt).toContain("read_social_performance_benchmark");
    expect(prompt).toContain("read_social_performance_discovery");
    expect(prompt).toContain("headline totals");
    expect(prompt).toContain("projectId");
    expect(prompt).not.toContain("omit projectId");
    expect(prompt).not.toContain("posting windows");
    expect(prompt).toContain("Do not invent a numeric draft score");
    expect(prompt).toContain("# Chat result previews");
    expect(prompt).toContain("# Chained work");
    expect(prompt).toContain("# Long and bulk work");
    expect(prompt).toContain("# Coding with your tools");
    expect(prompt).toContain("$SOKO_TOOLS_URL/<tool name>");
    expect(prompt).toContain("is a follow-up plan, not a schedule");
    expect(prompt).toContain("# Triage with Jev");
    expect(prompt).toContain('replyStates: ["NO_REPLY"]');
    for (const released of SOKO_BOT_VERSIONS.filter(
      (candidate) => candidate.id !== version.id,
    )) {
      expect(composeSystemPrompt(released)).not.toContain(
        "# Social performance insights",
      );
    }
  });
});
