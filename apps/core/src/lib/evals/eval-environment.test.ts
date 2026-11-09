import { afterEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ NETWORK: "Preprod" }));
vi.mock("@/config/env", () => ({ getEnv: () => env }));

import {
  dailyEvalsEnabled,
  evalCommit,
  evalEnvironment,
  prNumberFromCommitMessage,
} from "./eval-environment";

afterEach(() => {
  vi.unstubAllEnvs();
  env.NETWORK = "Preprod";
});

describe("prNumberFromCommitMessage", () => {
  it("reads the PR a squash commit ends in", () => {
    expect(prNumberFromCommitMessage("feat(cmo): x (#6931)")).toBe(6931);
    expect(prNumberFromCommitMessage("feat: (#1) mentions (#6931)")).toBe(6931);
  });

  it("finds none in a commit that names no PR at its end", () => {
    expect(prNumberFromCommitMessage("chore: see #12 later")).toBeNull();
    expect(prNumberFromCommitMessage(null)).toBeNull();
  });
});

describe("evalEnvironment", () => {
  it("runs the daily evals on mainnet's production deploy only", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    env.NETWORK = "Mainnet";
    expect(evalEnvironment()).toBe("mainnet");
    expect(dailyEvalsEnabled()).toBe(true);
    env.NETWORK = "Preprod";
    expect(evalEnvironment()).toBe("preprod");
    expect(dailyEvalsEnabled()).toBe(false);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(evalEnvironment()).toBe("preview");
    vi.stubEnv("VERCEL_ENV", "");
    expect(evalEnvironment()).toBe("local");
  });
});

describe("evalCommit", () => {
  it("takes the commit from Vercel and the PR from its message on main", () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc123");
    vi.stubEnv(
      "VERCEL_GIT_COMMIT_MESSAGE",
      "feat(soko-bot): evals (#6940)\n\nBody",
    );
    vi.stubEnv("VERCEL_GIT_PULL_REQUEST_ID", "");
    expect(evalCommit()).toEqual({
      commitSha: "abc123",
      commitMessage: "feat(soko-bot): evals (#6940)",
      prNumber: 6940,
    });
  });

  it("takes a preview's PR from Vercel", () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_MESSAGE", "wip");
    vi.stubEnv("VERCEL_GIT_PULL_REQUEST_ID", "6941");
    expect(evalCommit().prNumber).toBe(6941);
  });
});
