"use client";

import { useQueryState } from "nuqs";
import { useState } from "react";
import { PurchaseSuccessModal } from "@/components/billing/purchase-success-modal";
import type { CoworkerOption } from "@/lib/types/coworker";

interface SubscriptionSuccessModalProps {
  coworkersPromise: Promise<CoworkerOption[]>;
  description: string;
  headline: string;
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
  status,
}: SubscriptionSuccessModalProps) {
  const [, setStatus] = useQueryState("status");
  const [open, setOpen] = useState(status === "success");

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      // Keep the checkout ID so a later consent grant (or reload) can track it.
      void setStatus(null);
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
