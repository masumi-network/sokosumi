import { getEnv } from "@/config/env";

export type EvalEnvironment = "mainnet" | "preprod" | "preview" | "local";

/** Where this Core runs, as an eval run records it. */
export function evalEnvironment(): EvalEnvironment {
  if (process.env.VERCEL_ENV === "production")
    return getEnv().NETWORK === "Mainnet" ? "mainnet" : "preprod";
  if (process.env.VERCEL_ENV === "preview") return "preview";
  return "local";
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
