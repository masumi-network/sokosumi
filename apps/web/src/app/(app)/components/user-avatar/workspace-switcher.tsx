"use client";

import type { AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
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
  successMessage?: string;
  router?: AppRouterInstance;
  pathname?: string;
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
      options.router.replace(jobsBasePath);
      options.router.refresh();
      return;
    }
  }

  options?.router?.refresh();
}

export function useWorkspaceSwitcher() {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const handleSelectWorkspace = (
    organizationId: string | null,
    options?: {
      shouldRedirectAgentJobsBasePath?: boolean;
      successMessage?: string;
    },
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      startTransition(() => {
        void switchOrganizationWorkspace(organizationId, {
          ...options,
          router,
          pathname,
        })
          .then(resolve)
          .catch((error) => {
            console.error("Failed to switch organization:", error);
            reject(error);
          });
      });
    });
  };

  return {
    isPending,
    handleSelectWorkspace,
  };
}
