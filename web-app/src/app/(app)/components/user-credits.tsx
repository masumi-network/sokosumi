import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/better-auth/auth";

export default async function UserCredits() {
  const t = await getTranslations("App.Header.NavMenu");
  const session = await auth.api.getSession({
    headers: await headers(),
  });
  console.log(session);
  const credits = 1337;

  return <>{t("creditsBalance", { balance: credits })}</>;
}
