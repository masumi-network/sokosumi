import type { SessionUser } from "@sokosumi/utils";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";
import type { CreditUsage } from "@/lib/types/credit";

export interface AccountSummaryCreditProps {
  planName: string | null;
  totalCredits: number | null;
  creditUsage: CreditUsage | null;
  subscriptionPeriodEndMs: number | null;
  currentTimestampMs: number;
  lowCreditsThreshold: number;
  buyCreditsLabel: string;
  buyCreditsPath: string;
}

export interface AccountSummaryIdentityProps {
  sessionUser: SessionUser;
}

/**
 * Account-summary chrome (header mobile control + desktop sidebar chip).
 * Presence = Admin (gated) + Settings drill before Logout.
 */
export interface AccountAdminSettingsChrome {
  adminMenuEnabled: boolean;
  members: MemberWithOrganization[];
  activeOrganizationId: string | null;
  showDeveloperVendors: boolean;
}

export type AccountPopoverPanel =
  | { kind: "root" }
  | { kind: "settings" }
  | { kind: "developer" }
  | { kind: "help" }
  | { kind: "legal" };
