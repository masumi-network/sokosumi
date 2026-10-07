import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import SignInErrorNotice from "@/auth/components/sign-in-error-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { loadAuthErrorSearchParams } from "./search-params";

// Only ever reached by a full redirect from Core, so there is no client
// navigation to keep instant.
export const instant = false;

const MAX_CODE_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 200;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Auth.SignInError");
  return { title: t("title") };
}

interface AuthErrorPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Core's `onAPIError.errorURL`: where Better Auth sends a failure that has no
 * callback URL of its own, such as a social callback whose state is gone or an
 * authorize request from a misconfigured client. Outside the `(auth)` layout,
 * so a person who is signed in still sees why. Anyone can link here with any
 * query, so the code keeps only its safe characters and the description is
 * shortened plain text.
 */
export default async function AuthErrorPage({
  searchParams,
}: AuthErrorPageProps) {
  const t = await getTranslations("Auth.SignInError");
  const { error, error_description } =
    await loadAuthErrorSearchParams(searchParams);
  const code =
    error?.replace(/[^A-Za-z0-9_-]/g, "").slice(0, MAX_CODE_LENGTH) ||
    "unknown";
  const description = error_description
    ?.trim()
    .slice(0, MAX_DESCRIPTION_LENGTH);

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-center text-2xl font-bold">
            <h1>{t("title")}</h1>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <SignInErrorNotice error={code} />
          <div className="flex flex-col gap-1 text-sm text-muted-foreground">
            <p>{t("code", { code })}</p>
            {description ? (
              <p className="break-words">{t("description", { description })}</p>
            ) : null}
          </div>
          <Button asChild variant="primary">
            <Link href="/signin">{t("backToSignIn")}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
