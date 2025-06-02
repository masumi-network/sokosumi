import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/utils";
import { getUserById } from "@/lib/db";
import { canClaimFreeCredits, getCredits } from "@/lib/services";

import FreeCreditsButton from "./free-credits-button";

export default async function UserCredits() {
  const t = await getTranslations("App.Header.Credit");
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  if (!session?.user.id) {
    return (
      <div className="text-muted-foreground text-sm">{t("unavailable")}</div>
    );
  }

  const user = await getUserById(session.user.id);

  if (!user) {
    return (
      <div className="text-muted-foreground text-sm">{t("unavailable")}</div>
    );
  }

  const credits = await getCredits(session.user.id);
  const claimable = await canClaimFreeCredits(session.user.id);

  return (
    <div className="flex items-center gap-4">
      {claimable ? (
        <FreeCreditsButton />
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
