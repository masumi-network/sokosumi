import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth/auth";
import { getUserById } from "@/lib/db";
import { getCredits } from "@/lib/services";

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
    <div className="flex flex-col items-end gap-0.5">
      <div className="text-sm font-semibold">{user.name}</div>
      <div className="text-muted-foreground text-xs">
        {t("balance", { credits: credits })}
      </div>
    </div>
  );
}
