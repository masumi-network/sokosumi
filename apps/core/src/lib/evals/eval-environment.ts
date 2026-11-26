import { getEnv } from "@/config/env";
import { localChatGptPlanEnabled } from "@/lib/local-chatgpt-plan";

export type EvalEnvironment =
  | "mainnet"
  | "preprod"
  | "preview"
  | "local"
  | "local-chatgpt-plan";

/**
 * Where this Core runs, as an eval run records it. A ChatGPT plan run is its
 * own environment: its models differ, so it is compared only with plan runs.
 */
export function evalEnvironment(): EvalEnvironment {
  if (process.env.VERCEL_ENV === "production")
    return getEnv().NETWORK === "Mainnet" ? "mainnet" : "preprod";
  if (process.env.VERCEL_ENV === "preview") return "preview";
  return localChatGptPlanEnabled() ? "local-chatgpt-plan" : "local";
}

/**
 * Which runs a run is compared with: daily runs, or for a ChatGPT plan run
 * only other plan runs, since plan models differ from production's.
 */
export function comparableRuns(
  environment: string,
): { environment: "local-chatgpt-plan" } | { trigger: "DAILY" } {
  return environment === "local-chatgpt-plan"
    ? { environment: "local-chatgpt-plan" }
    : { trigger: "DAILY" };
}

/** The daily run belongs to mainnet's production deploy of main only. */
export function dailyEvalsEnabled(): boolean {
  return evalEnvironment() === "mainnet";
}

/** "feat(x): y (#6931)" → 6931: main's squash commits end in their PR. */
export function prNumberFromCommitMessage(message: string | null) {
  const match = message?.match(/\(#(\d+)\)\s*$/m);
  return match ? Number(match[1]) : null;
}

/** The commit this Core was built from, and the PR it came from. */
export function evalCommit(): {
  commitSha: string | null;
  commitMessage: string | null;
  prNumber: number | null;
} {
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA || null;
  const commitMessage =
    process.env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n")[0]?.trim() || null;
  const previewPr = Number(process.env.VERCEL_GIT_PULL_REQUEST_ID);
  return {
    commitSha,
    commitMessage,
    prNumber:
      Number.isInteger(previewPr) && previewPr > 0
        ? previewPr
        : prNumberFromCommitMessage(commitMessage),
  };
}
