import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth/auth";
import { getUserById } from "@/lib/db/services/user.service";

export default async function UserCredits() {
  const t = await getTranslations("App.Header.NavMenu.Credit");
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user.id) {
    return <>{t("unavailable")}</>;
  }

  const user = await getUserById(session.user.id);

  if (!user) {
    return <>{t("unavailable")}</>;
  }
  return <>{t("balance", { credits: user.credits })}</>;
}
