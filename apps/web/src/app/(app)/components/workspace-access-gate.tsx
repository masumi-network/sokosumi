import { redirect } from "next/navigation";

import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { userService } from "@/lib/services";
import { isWorkspaceReady, WORKSPACE_GATE_PATH } from "@/lib/workspace-gate";

interface WorkspaceAccessGateProps {
  children: React.ReactNode;
}

/**
 * Hard gate before app chrome Suspense. Not-ready / inventory failure redirects
 * to `/workspace-gate` without mounting sidebar/header fallbacks.
 * Inventory is React-cached with AuthenticatedAppFrame (one Core hit per request).
 */
export default async function WorkspaceAccessGate({
  children,
}: WorkspaceAccessGateProps) {
  await getSessionOrRedirect();

  let inventoryGate: string | null = null;
  try {
    const inventory = await userService.getWorkspaceInventory();
    inventoryGate = inventory?.gate ?? null;
  } catch (error) {
    console.error("Failed to load workspace inventory for access gate", error);
  }

  if (!isWorkspaceReady(inventoryGate)) {
    redirect(WORKSPACE_GATE_PATH);
  }

  return children;
}
