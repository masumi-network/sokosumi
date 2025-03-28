import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/better-auth/auth";
import { getUserById } from "@/lib/db/services/user.service";

export default async function UserCredits() {
  const t = await getTranslations("App.Header.NavMenu");
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user.id) {
    return <>{t("creditsUnavailable")}</>;
  }

  const user = await getUserById(session.user.id);

  if (!user) {
    return <>{t("creditsUnavailable")}</>;
  }
  return <>{t("creditsBalance", { credits: user.credits })}</>;
}
