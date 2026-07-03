"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { updatePreferredOrganization } from "@/lib/actions/organization";
import { authClient } from "@/lib/auth/auth.client";

export function getAgentJobsBasePath(pathname: string): string | null {
  const jobsRouteMatch = pathname.match(/^\/agents\/([^/]+)\/jobs(?:\/.*)?$/);
  if (!jobsRouteMatch) {
    return null;
  }

  const [, agentId] = jobsRouteMatch;
  return `/agents/${agentId}/jobs`;
}

export function getTaskDetailBasePath(pathname: string): string | null {
  const taskDetailRouteMatch = pathname.match(/^\/tasks\/(?!new$)[^/]+$/);
  if (!taskDetailRouteMatch) {
    return null;
  }

  return "/tasks";
}

export async function activateOrganizationWorkspace(
  organizationId: string | null,
): Promise<void> {
  await authClient.organization.setActive({
    organizationId,
  });

  try {
    const result = await updatePreferredOrganization({
      organizationId,
    });

    if (!result.ok) {
      console.error("Failed to persist preferred organization:", result.error);
    }
  } catch (error) {
    console.error("Failed to persist preferred organization:", error);
  }
}

interface SwitchOrganizationWorkspaceOptions {
  shouldRedirectAgentJobsBasePath?: boolean;
  shouldRedirectTaskDetailPath?: boolean;
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

export async function switchOrganizationWorkspace(
  organizationId: string | null,
  options?: SwitchOrganizationWorkspaceOptions,
): Promise<void> {
  await activateOrganizationWorkspace(organizationId);

  if (options?.successMessage) {
    toast.success(options.successMessage);
  }

  const shouldRedirectAgentJobsBasePath =
    options?.shouldRedirectAgentJobsBasePath ?? true;
  if (shouldRedirectAgentJobsBasePath && options?.router && options?.pathname) {
    const jobsBasePath = getAgentJobsBasePath(options.pathname);
    if (jobsBasePath) {
      runRouterTransition(() => {
        options.router?.replace(jobsBasePath);
        options.router?.refresh();
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
        options.router?.refresh();
      }, options.startTransition);
      return;
    }
  }

  if (options?.router) {
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

  const handleSelectWorkspace = (
    organizationId: string | null,
    options?: {
      shouldRedirectAgentJobsBasePath?: boolean;
      shouldRedirectTaskDetailPath?: boolean;
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
    isPending: isActivating || isRefreshing,
    handleSelectWorkspace,
  };
}
