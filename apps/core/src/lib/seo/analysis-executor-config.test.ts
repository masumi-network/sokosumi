import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getEnv } from "@/config/env";
import { isGlobalSeoExecutor } from "./analysis-executor-config";

const env = getEnv();
const previous = env.SEO_ANALYSIS_EXECUTOR;
const capabilities = { canUsePaidSearchData: true, canSchedule: true };
const WORKER = "seo-worker";

describe("isGlobalSeoExecutor", () => {
  beforeEach(() => {
    env.SEO_ANALYSIS_EXECUTOR = {
      ...capabilities,
      mode: "global",
      coworkerId: WORKER,
    };
  });
  afterEach(() => {
    env.SEO_ANALYSIS_EXECUTOR = previous;
  });

  it("lets the global worker in on a direct call", () => {
    expect(isGlobalSeoExecutor({ coworkerId: WORKER })).toBe(true);
  });

  it("refuses another coworker", () => {
    expect(isGlobalSeoExecutor({ coworkerId: "someone-else" })).toBe(false);
  });

  it("refuses the global worker acting inside a Task context", () => {
    expect(
      isGlobalSeoExecutor({ coworkerId: WORKER, context: { taskId: "t" } }),
    ).toBe(false);
  });

  it("refuses a scoped executor: it serves one customer only", () => {
    env.SEO_ANALYSIS_EXECUTOR = {
      ...capabilities,
      coworkerId: WORKER,
      workspaceId: "0b6a3a0e-4a39-4a8e-9d0a-2f1e9f0c7c11",
      ownerId: "owner",
      organizationId: null,
    };
    expect(isGlobalSeoExecutor({ coworkerId: WORKER })).toBe(false);
  });

  it("refuses everyone when no worker is configured", () => {
    env.SEO_ANALYSIS_EXECUTOR = undefined;
    expect(isGlobalSeoExecutor({ coworkerId: WORKER })).toBe(false);
  });
});
