"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CommonErrorCode } from "@/lib/actions";
import {
  openOrganizationBillingPortal,
  openPersonalBillingPortal,
} from "@/lib/actions/subscription";

interface BillingPortalCardProps {
  baseReturnPath?: string;
  ctaLabel: string;
  description: string;
  generalErrorMessage: string;
  openingLabel: string;
  organizationId?: string | null;
  returnPath: string;
  title: string;
  unauthenticatedActionLabel: string;
  unauthenticatedErrorMessage: string;
  unauthorizedErrorMessage?: string;
}

export function BillingPortalCard({
  baseReturnPath,
  ctaLabel,
  description,
  generalErrorMessage,
  openingLabel,
  organizationId = null,
  returnPath,
  title,
  unauthenticatedActionLabel,
  unauthenticatedErrorMessage,
  unauthorizedErrorMessage,
}: BillingPortalCardProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  function resolveReturnPath(): string {
    if (!baseReturnPath) {
      return returnPath;
    }

    const searchParams = new URLSearchParams(window.location.search);
    const tab = searchParams.get("tab");
    if (!tab) {
      return baseReturnPath;
    }

    const encodedTab = encodeURIComponent(tab);
    return `${baseReturnPath}?tab=${encodedTab}`;
  }

  async function handleOpenBillingPortal() {
    setIsPending(true);
    try {
      const resolvedReturnPath = resolveReturnPath();
      const result = organizationId
        ? await openOrganizationBillingPortal({
            organizationId,
            returnPath: resolvedReturnPath,
          })
        : await openPersonalBillingPortal({ returnPath: resolvedReturnPath });

      if (!result.ok) {
        switch (result.error.code) {
          case CommonErrorCode.UNAUTHENTICATED:
            toast.error(unauthenticatedErrorMessage, {
              action: {
                label: unauthenticatedActionLabel,
                onClick: () => {
                  router.push("/login");
                },
              },
            });
            return;
          case CommonErrorCode.UNAUTHORIZED:
            toast.error(unauthorizedErrorMessage ?? generalErrorMessage);
            return;
          default:
            toast.error(generalErrorMessage);
            return;
        }
      }

      window.location.href = result.data.url;
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1.5">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button
          variant="outline"
          className="self-start md:self-center"
          disabled={isPending}
          onClick={() => {
            void handleOpenBillingPortal();
          }}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              {openingLabel}
            </>
          ) : (
            ctaLabel
          )}
        </Button>
      </CardHeader>
    </Card>
  );
}
