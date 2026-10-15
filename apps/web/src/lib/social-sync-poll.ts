export function socialSyncPollIntervalMs(
  accounts: readonly { sync?: { status: string } | null | undefined }[],
): number | false {
  return accounts.some((account) => {
    const status = account.sync?.status;
    return status === "queued" || status === "running";
  })
    ? 10_000
    : false;
}
