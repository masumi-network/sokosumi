import { redirect } from "next/navigation";

import { signInRedirectPath } from "@/lib/auth/auth.server";
import { readRouteSession } from "@/lib/auth/route-session";
import { userService } from "@/lib/services";
import { isWorkspaceReady, WORKSPACE_GATE_PATH } from "@/lib/workspace-gate";
import { CoreUnavailableNotice } from "./core-unavailable-notice.client";

interface WorkspaceAccessGateProps {
  children: React.ReactNode;
}

/**
 * Hard gate before app chrome Suspense. Not-ready / workspace-access failure
 * redirects to `/setup` without mounting sidebar/header fallbacks.
 * Workspace access is React-cached with AuthenticatedAppFrame (one Core hit
 * per request).
 */
export default async function WorkspaceAccessGate({
  children,
}: WorkspaceAccessGateProps) {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "unavailable") {
    return <CoreUnavailableNotice />;
  }
  if (sessionRead.status === "signedOut") {
    redirect(await signInRedirectPath());
  }

  let workspaceGate: string | null = null;
  try {
    const workspaceAccess = await userService.getWorkspaceAccess();
    workspaceGate = workspaceAccess?.gate ?? null;
  } catch (error) {
    console.error("Failed to load workspace access for access gate", error);
  }

  if (!isWorkspaceReady(workspaceGate)) {
    redirect(WORKSPACE_GATE_PATH);
  }

  return children;
}
