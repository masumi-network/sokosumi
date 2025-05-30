import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { claimFreeCredits } from "@/lib/actions";
import { User } from "@/prisma/generated/client";

interface FreeCreditsButtonServerProps {
  user: User;
  priceId: string;
  coupon: string;
}

export default async function FreeCreditsButtonServer({
  user,
  priceId,
  coupon,
}: FreeCreditsButtonServerProps) {
  const t = await getTranslations("App.Billing.FreeClaim");

  async function handleClaimFreeCredits() {
    "use server";

    const result = await claimFreeCredits(priceId, coupon);

    if (result.success && result.url) {
      // In a server action, we need to use redirect instead of window.location.href
      const { redirect } = await import("next/navigation");
      redirect(result.url);
    } else {
      // For server actions, we can't show toast notifications directly
      // We would need to handle errors differently, perhaps by redirecting to an error page
      // or by using search params to show error state
      console.error("Failed to claim free credits:", result.error);
    }
  }

  return (
    <form action={handleClaimFreeCredits}>
      <Button type="submit">{t("button")}</Button>
    </form>
  );
}
