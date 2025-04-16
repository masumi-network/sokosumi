import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { auth } from "@/lib/auth/auth";
import { getCredits } from "@/lib/db/services/credit.service";
import { getUserById } from "@/lib/db/services/user.service";
import { cn } from "@/lib/utils";

export default async function UserCredits({
  className,
}: {
  className?: string;
}) {
  const t = await getTranslations("App.Header.Credit");
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user.id) {
    return <div className={cn(className)}>{t("unavailable")}</div>;
  }

  const user = await getUserById(session.user.id);
  const credits = await getCredits(session.user.id);

  if (!user) {
    return <div className={cn(className)}>{t("unavailable")}</div>;
  }
  return (
    <div className={cn(className)}>{t("balance", { credits: credits })}</div>
  );
}
