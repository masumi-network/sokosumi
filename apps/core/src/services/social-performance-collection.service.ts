import {
  type RunDueSocialAccountSyncInput,
  type RunDueSocialAccountSyncResult,
  runDueSocialAccountSync,
} from "@/services/social-account-sync";

/** Cron entry. Same writer as connect waitUntil and Settings Sync now. */
export async function collectSocialPerformance(
  input: RunDueSocialAccountSyncInput,
): Promise<RunDueSocialAccountSyncResult> {
  return runDueSocialAccountSync(input);
}
