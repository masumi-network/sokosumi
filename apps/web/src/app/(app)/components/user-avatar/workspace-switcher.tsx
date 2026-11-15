"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  CHAT_WELCOME_PATH,
  roomIdFromPath,
} from "@/app/chat/utils/chat-route-base";
import {
  activateOrganizationWorkspace,
  isUserNotMemberOfOrganizationError,
} from "@/lib/activate-organization-workspace";
import { isListedInWorkspace } from "@/lib/chat/room-workspace-scope";
import { coreClient } from "@/lib/clients/core.browser.client";

export function getAgentJobsBasePath(pathname: string): string | null {
  const jobsRouteMatch = pathname.match(/^\/agents\/([^/]+)\/jobs(?:\/.*)?$/);
  if (!jobsRouteMatch) {
    return null;
  }

  const [, agentId] = jobsRouteMatch;
  return `/agents/${agentId}/jobs`;
}

export function getTaskDetailBasePath(pathname: string): string | null {
  const taskDetailRouteMatch = pathname.match(/^\/tasks\/[^/]+$/);
  if (!taskDetailRouteMatch) {
    return null;
  }

  return "/tasks";
}

export function getOrganizationSettingsPath(
  pathname: string,
  organizationId?: string | null,
): string | null {
  const isOrganizationSettings =
    pathname === "/organization" || /^\/organizations\/.+/.test(pathname);

  if (!isOrganizationSettings) {
    return null;
  }

  // Personal workspace has no active org; `/organization` would only bounce home.
  if (organizationId === null) {
    return "/";
  }

  return "/organization";
}

interface SwitchOrganizationWorkspaceOptions {
  shouldRedirectAgentJobsBasePath?: boolean;
  shouldRedirectTaskDetailPath?: boolean;
  shouldRedirectOrganizationSettingsPath?: boolean;
  successMessage?: string;
  router?: AppRouterInstance;
  pathname?: string;
  startTransition?: (callback: () => void) => void;
}

function runRouterTransition(
  callback: () => void,
  startTransition?: (callback: () => void) => void,
) {
  if (startTransition) {
    startTransition(callback);
    return;
  }

  callback();
}

async function roomStaysOpen(
  roomId: string,
  workspaceId: string | null,
): Promise<boolean> {
  try {
    const { data } = await coreClient.getChatRoom(roomId);
    return isListedInWorkspace(data, workspaceId);
  } catch (error) {
    console.warn("Failed to read the open room after a switch", {
      roomId,
      error,
    });
    // A failed read is not an answer: the refreshed page says if the room is gone.
    return true;
  }
}

export async function switchOrganizationWorkspace(
  organizationId: string | null,
  options?: SwitchOrganizationWorkspaceOptions,
): Promise<void> {
  let appliedOrganizationId = organizationId;
  let rendered: boolean;

  try {
    rendered = await activateOrganizationWorkspace(organizationId);
  } catch (error) {
    if (!isUserNotMemberOfOrganizationError(error) || organizationId === null) {
      throw error;
    }

    // Better Auth clears the session org in the adapter, then 403s without
    // updating the cookie. Finish the personal switch so preferred org,
    // chrome cache, and `/organization` match membership.
    rendered = await activateOrganizationWorkspace(null);
    appliedOrganizationId = null;
  }

  // The preferred-workspace action already sent the page rendered for the new
  // workspace; refreshing as well rendered the whole app twice per switch.
  const refreshUnlessRendered = () => {
    if (!rendered) options?.router?.refresh();
  };

  if (options?.successMessage && appliedOrganizationId === organizationId) {
    toast.success(options.successMessage);
  }

  const shouldRedirectAgentJobsBasePath =
    options?.shouldRedirectAgentJobsBasePath ?? true;
  if (shouldRedirectAgentJobsBasePath && options?.router && options?.pathname) {
    const jobsBasePath = getAgentJobsBasePath(options.pathname);
    if (jobsBasePath) {
      runRouterTransition(() => {
        options.router?.replace(jobsBasePath);
        refreshUnlessRendered();
      }, options.startTransition);
      return;
    }
  }

  const shouldRedirectTaskDetailPath =
    options?.shouldRedirectTaskDetailPath ?? true;
  if (shouldRedirectTaskDetailPath && options?.router && options?.pathname) {
    const taskDetailBasePath = getTaskDetailBasePath(options.pathname);
    if (taskDetailBasePath) {
      runRouterTransition(() => {
        options.router?.replace(taskDetailBasePath);
        refreshUnlessRendered();
      }, options.startTransition);
      return;
    }
  }

  const shouldRedirectOrganizationSettingsPath =
    options?.shouldRedirectOrganizationSettingsPath ?? true;
  if (
    shouldRedirectOrganizationSettingsPath &&
    options?.router &&
    options?.pathname
  ) {
    const organizationSettingsPath = getOrganizationSettingsPath(
      options.pathname,
      appliedOrganizationId,
    );
    if (organizationSettingsPath) {
      runRouterTransition(() => {
        options.router?.replace(organizationSettingsPath);
        refreshUnlessRendered();
      }, options.startTransition);
      return;
    }
  }

  // The room page opens any room the reader belongs to as a Room visit
  // (ADR-0061), so refreshing in place would never close the one being left.
  const openRoomId = roomIdFromPath(options?.pathname);
  if (
    options?.router &&
    openRoomId &&
    !(await roomStaysOpen(openRoomId, appliedOrganizationId))
  ) {
    runRouterTransition(() => {
      options.router?.replace(CHAT_WELCOME_PATH);
      refreshUnlessRendered();
    }, options.startTransition);
    return;
  }

  if (options?.router && !rendered) {
    runRouterTransition(() => {
      options.router?.refresh();
    }, options.startTransition);
  }
}

export function useWorkspaceSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const [isActivating, setIsActivating] = useState(false);
  const [isRefreshing, startTransition] = useTransition();
  const isPending = isActivating || isRefreshing;
  const settlersRef = useRef<Array<() => void>>([]);

  // The refresh runs in this hook's transition, so only its pending state
  // says when the new workspace has rendered.
  useEffect(() => {
    if (isPending) return;
    for (const settle of settlersRef.current.splice(0)) settle();
  }, [isPending]);

  /** Resolves once the next switch has rendered. Ask before starting it. */
  const whenSettled = () =>
    new Promise<void>((resolve) => {
      settlersRef.current.push(resolve);
    });

  const handleSelectWorkspace = (
    organizationId: string | null,
    options?: {
      shouldRedirectAgentJobsBasePath?: boolean;
      shouldRedirectTaskDetailPath?: boolean;
      shouldRedirectOrganizationSettingsPath?: boolean;
      successMessage?: string;
    },
  ): Promise<void> => {
    setIsActivating(true);

    return switchOrganizationWorkspace(organizationId, {
      ...options,
      router,
      pathname,
      startTransition,
    })
      .catch((error) => {
        console.error("Failed to switch organization:", error);
        throw error;
      })
      .finally(() => {
        setIsActivating(false);
      });
  };

  return {
    isPending,
    handleSelectWorkspace,
    whenSettled,
  };
}
