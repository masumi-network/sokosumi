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
    ] as const) {
      for (const route of SOKO_BOT_ROUTES) {
        expect(SOKO_BOT_ROUTE_CAPABILITIES[route]).toContain(capability);
      }
      expect(SOKO_BOT_BOT_TO_BOT_CAPABILITIES).not.toContain(capability);
    }
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
    expect(DEFAULT_SOKO_BOT_VERSION_ID).toBe("v23");
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
