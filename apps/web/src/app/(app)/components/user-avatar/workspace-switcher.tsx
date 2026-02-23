"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth/auth.client";

export function getAgentJobsBasePath(pathname: string): string | null {
  const jobsRouteMatch = pathname.match(/^\/agents\/([^/]+)\/jobs(?:\/.*)?$/);
  if (!jobsRouteMatch) {
    return null;
  }

  const [, agentId] = jobsRouteMatch;
  return `/agents/${agentId}/jobs`;
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
        await authClient.organization.setActive({
          organizationId,
        });

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
