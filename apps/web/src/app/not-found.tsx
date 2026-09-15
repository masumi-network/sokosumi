import { DEFAULT_LOCALE } from "@sokosumi/utils";
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";

import { ImpersonationBanner } from "@/components/impersonation/impersonation-banner";
import { Button } from "@/components/ui/button";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { readRouteSession } from "@/lib/auth/route-session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({
    locale: DEFAULT_LOCALE,
    namespace: "NotFound",
  });
  return {
    title: t("title"),
    description: t("description"),
  };
}

// This boundary MUST stay synchronous. Making it `async` breaks every
// route's PPR resume (React throws "Expected a suspended thenable", the
// render aborts, and dynamic holes stream empty) on Next 16 + Turbopack.
// Async work — the session read for the impersonation banner — lives in
// the Suspense child below, which is safe. See SOK-1080.
export default function NotFound() {
  const t = useTranslations("NotFound");

  return (
    <div className="flex min-h-svh flex-col">
      <Suspense fallback={null}>
        <NotFoundImpersonationBanner />
      </Suspense>
      <div className="flex flex-1 items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center text-4xl font-bold">
              {t("title")}
            </CardTitle>
            <CardDescription className="text-center text-lg">
              {t("description")}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-muted-foreground text-center">
            <p>{t("message")}</p>
          </CardContent>
          <CardFooter className="flex justify-center">
            <Button asChild>
              <Link href="/">{t("returnHome")}</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

// not-found renders outside every nested layout, so the app chrome (and
// its impersonation banner) is gone here. Mount the banner explicitly so
// an impersonated session — e.g. one refused by an admin page — never
// loses sight of Exit. Anonymous reads short-circuit without Core I/O.
// Exported for tests: async Server Components can't render in happy-dom,
// so tests await it directly like the repo's async layout tests.
export async function NotFoundImpersonationBanner() {
  const sessionRead = await readRouteSession();
  if (sessionRead.status !== "authenticated") {
    return null;
  }
  const session = sessionRead.session;
  return (
    <ImpersonationBanner
      name={session.user.name}
      email={session.user.email}
      impersonatedBy={session.session.impersonatedBy ?? null}
    />
  );
}
