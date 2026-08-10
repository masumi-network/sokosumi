import { getDeveloperVendorAdminAccess } from "@/app/developer/get-developer-vendor-admin-access";
import type {
  Coworker,
  CoworkerWorkspaceAccess,
} from "@/lib/clients/generated/core";
import { coworkerAccessService } from "@/lib/services/coworker-access.service";

import { DeveloperCoworkerEarlyAccess } from "./developer-coworker-early-access";

interface DeveloperCoworkerEarlyAccessSectionProps {
  coworker: Coworker;
}

/**
 * Vendor-admin only dogfood surface: enable/propose coworker early access
 * by organization slug or user email (exact match; no directory browse).
 * Core enforces member → GRANTED / foreign → PENDING.
 */
export async function DeveloperCoworkerEarlyAccessSection({
  coworker,
}: DeveloperCoworkerEarlyAccessSectionProps) {
  const { adminVendors } = await getDeveloperVendorAdminAccess();
  const isVendorAdmin = adminVendors.some(
    (membership) => membership.id === coworker.vendor.id,
  );

  if (!isVendorAdmin) {
    return null;
  }

  let accessRows: CoworkerWorkspaceAccess[] = [];
  try {
    accessRows = await coworkerAccessService.listForCoworker(coworker.id);
  } catch (error) {
    console.error("Failed to load coworker workspace access rows", error);
  }

  return (
    <DeveloperCoworkerEarlyAccess
      coworkerId={coworker.id}
      accessRows={accessRows}
    />
  );
}
