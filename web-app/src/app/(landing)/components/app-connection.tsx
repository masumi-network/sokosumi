import { Link } from "@react-email/components";
import { UserRoundIcon } from "lucide-react";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { auth } from "@/lib/better-auth/auth";

import AuthButtons from "./auth-buttons";

export default async function AppConnection() {
  const t = await getTranslations("Landing.Header.Connection");
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return <AuthButtons />;
  }

  return (
    <Link href="/dashboard" target="_self">
      <Button>
        <UserRoundIcon className="size-4" />
        {t("dashboard")}
      </Button>
    </Link>
  );
}
