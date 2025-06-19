import { UserRoundIcon } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth/utils";

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
  const session = await getSession();

  if (!session) {
    return <AuthButtons />;
  }

  return (
    <Button variant="primary" asChild>
      <Link href="/app">
        <UserRoundIcon className="size-4" />
        {t("app")}
      </Link>
    </Button>
  );
}
