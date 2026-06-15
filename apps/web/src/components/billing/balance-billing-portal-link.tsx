"use client";

import { ChevronRight, Loader2, ReceiptText } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CommonErrorCode } from "@/lib/actions";
import {
  openOrganizationBillingPortal,
  openPersonalBillingPortal,
} from "@/lib/actions/subscription";

interface BalanceBillingPortalLinkProps {
  baseReturnPath?: string;
  description: string;
  generalErrorMessage: string;
  label: string;
  openingLabel: string;
  organizationId?: string | null;
  returnPath: string;
  unauthenticatedActionLabel: string;
  unauthenticatedErrorMessage: string;
  unauthorizedErrorMessage?: string;
}

export function BalanceBillingPortalLink({
  baseReturnPath,
  description,
  generalErrorMessage,
  label,
  openingLabel,
  organizationId = null,
  returnPath,
  unauthenticatedActionLabel,
  unauthenticatedErrorMessage,
  unauthorizedErrorMessage,
}: BalanceBillingPortalLinkProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  function resolveReturnPath(): string {
    if (!baseReturnPath) return returnPath;

    const searchParams = new URLSearchParams(window.location.search);
    const tab = searchParams.get("tab");
    if (!tab) return baseReturnPath;

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
        : await openPersonalBillingPortal({
            returnPath: resolvedReturnPath,
          });

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
    <Button
      type="button"
      variant="ghost"
      className="group h-auto w-full justify-start gap-3 rounded-lg p-3 text-left hover:bg-accent/60 has-[>svg]:px-3"
      disabled={isPending}
      aria-busy={isPending}
      onClick={() => {
        void handleOpenBillingPortal();
      }}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {isPending ? (
          <Loader2 className="size-5 animate-spin" />
        ) : (
          <ReceiptText className="size-5" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-semibold text-primary">
          {isPending ? openingLabel : label}
        </span>
        <span className="text-muted-foreground text-sm leading-snug whitespace-normal">
          {description}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
    </Button>
  );
}
