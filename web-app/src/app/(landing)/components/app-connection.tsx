import { Link } from "@react-email/components";
import { UserRoundIcon } from "lucide-react";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { auth } from "@/lib/auth/auth";
import { AppRoute } from "@/types/routes";

import AuthButtons from "./auth-buttons";

function AppConnectionLoading() {
  return (
    <Button disabled>
      <UserRoundIcon className="size-4 animate-pulse" />
    </Button>
  );
}

export default function AppConnection() {
  return (
    <Suspense fallback={<AppConnectionLoading />}>
      <AppConnectionContent />
    </Suspense>
  );
}

async function AppConnectionContent() {
  const t = await getTranslations("Landing.Header.Connection");
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session) {
    return <AuthButtons />;
  }

  return (
    <Link href={AppRoute.Home} target="_self">
      <Button>
        <UserRoundIcon className="size-4" />
        {t("dashboard")}
      </Button>
    </Link>
  );
}
