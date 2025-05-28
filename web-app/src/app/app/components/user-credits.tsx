import { headers } from "next/headers";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { getEnvSecrets } from "@/config/env.config";
import { auth } from "@/lib/auth/auth";
import { getUserById } from "@/lib/db";
import { getCredits } from "@/lib/services";

import FreeCreditsButton from "./free-credits-button";

export default async function UserCredits() {
  const t = await getTranslations("App.Header.Credit");
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user.id) {
    return (
      <div className="text-muted-foreground text-sm">{t("unavailable")}</div>
    );
  }

  const user = await getUserById(session.user.id);
  const credits = await getCredits(session.user.id);

  if (!user) {
    return (
      <div className="text-muted-foreground text-sm">{t("unavailable")}</div>
    );
  }

  return (
    <div className="flex items-center gap-4">
      {user.stripeCustomerId == null ? (
        <FreeCreditsButton
          userId={user.id}
          priceId={getEnvSecrets().STRIPE_PRICE_ID}
          coupon={getEnvSecrets().STRIPE_WELCOME_COUPON}
        />
      ) : (
        credits <= 50.0 && (
          <Button variant="default" size="sm" asChild>
            <Link href="/app/billing">{t("buy")}</Link>
          </Button>
        )
      )}
      <div className="flex flex-col items-end gap-0.5">
        <div className="text-sm font-semibold">{user.name}</div>
        <div className="text-muted-foreground text-xs">
          {t("balance", { credits: credits })}
        </div>
      </div>
    </div>
  );
}
