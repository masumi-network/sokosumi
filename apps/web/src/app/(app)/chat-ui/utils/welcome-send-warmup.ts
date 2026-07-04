export function isCoworkerWarmupReadyForWelcomeSend(params: {
  warmupState: "pending" | "ready" | "failed" | null;
  warmupFailed: boolean;
}): boolean {
  return (
    params.warmupState === "ready" ||
    params.warmupState === "failed" ||
    params.warmupFailed
  );
}
