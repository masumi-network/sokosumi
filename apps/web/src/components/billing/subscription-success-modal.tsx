"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PurchaseSuccessModal } from "@/components/billing/purchase-success-modal";
import type { CoworkerOption } from "@/lib/types/coworker";

interface SubscriptionSuccessModalProps {
  coworkersPromise: Promise<CoworkerOption[]>;
  description: string;
  headline: string;
  returnPath: string;
  status: "cancel" | "success" | null;
}

/**
 * Rendered once per billing page load, as a sibling of `BillingTabs` — not
 * nested inside PersonalSubscriptionSection/OrganizationSubscriptionSection,
 * which live inside Radix's conditionally-mounted tab content and unmount
 * every time the user switches away from the Subscription tab. Owning the
 * open state here means a tab switch (and back) can never re-trigger it.
 */
export function SubscriptionSuccessModal({
  coworkersPromise,
  description,
  headline,
  returnPath,
  status,
}: SubscriptionSuccessModalProps) {
  const router = useRouter();
  const [open, setOpen] = useState(status === "success");

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      router.replace(returnPath);
    }
  }

  return (
    <PurchaseSuccessModal
      open={open}
      onOpenChange={handleOpenChange}
      headline={headline}
      description={description}
      coworkersPromise={coworkersPromise}
    />
  );
}
