"use client";

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
      console.error(
        "Failed to persist preferred organization:",
        result.error,
      );
    }
  } catch (error) {
    console.error("Failed to persist preferred organization:", error);
  }
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
  ) => {
    startTransition(async () => {
      try {
        await activateOrganizationWorkspace(organizationId);

        if (options?.successMessage) {
          toast.success(options.successMessage);
        }

        const shouldRedirectAgentJobsBasePath =
          options?.shouldRedirectAgentJobsBasePath ?? true;
        if (shouldRedirectAgentJobsBasePath) {
          const jobsBasePath = getAgentJobsBasePath(pathname);
          if (jobsBasePath) {
            router.replace(jobsBasePath);
            router.refresh();
            return;
          }
        }

        router.refresh();
      } catch (error) {
        console.error("Failed to switch organization:", error);
      }
    });
  };

  return {
    isPending,
    handleSelectWorkspace,
  };
}
