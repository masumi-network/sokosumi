import { DEFAULT_LOCALE } from "@sokosumi/utils";
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";

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

export default async function NotFound() {
  const t = useTranslations("NotFound");

  // not-found renders outside every nested layout, so the app chrome (and
  // its impersonation banner) is gone here. Mount the banner explicitly so
  // an impersonated session — e.g. one refused by an admin page — never
  // loses sight of Exit. Anonymous reads short-circuit without Core I/O.
  const sessionRead = await readRouteSession();
  const session =
    sessionRead.status === "authenticated" ? sessionRead.session : null;

  return (
    <div className="flex min-h-svh flex-col">
      {session ? (
        <ImpersonationBanner
          name={session.user.name}
          email={session.user.email}
          impersonatedBy={session.session.impersonatedBy ?? null}
        />
      ) : null}
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
