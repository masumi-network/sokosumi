"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { authClient } from "@/lib/auth/auth.client";

export function useWorkspaceSwitcher() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleSelectWorkspace = (organizationId: string | null) => {
    startTransition(async () => {
      try {
        await authClient.organization.setActive({
          organizationId,
        });
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
