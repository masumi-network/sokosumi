"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";
import { authClient } from "@/lib/auth/auth.client";

interface OAuthHandBackProps {
  /** The signed OAuth request the page carries. */
  oauthQuery: string;
  /** The product the person is continuing to, when Core could name it. */
  clientName?: string | undefined;
}

/**
 * Shown in place of the sign-in or sign-up form to a person who is already
 * signed in and carries an OAuth request: hands the request back to Core's
 * OAuth provider, which answers with where to go next.
 *
 * It never navigates itself. Better Auth's client follows the provider's
 * `{ redirect: true, url }`, and a second navigation would deliver the
 * authorization code twice, for which Core revokes a confidential client's
 * tokens.
 */
export default function OAuthHandBack({
  oauthQuery,
  clientName,
}: OAuthHandBackProps) {
  const t = useTranslations("Auth.OAuthHandBack");
  const [hasFailed, setHasFailed] = useState(false);
  const hasStarted = useRef(false);

  useMountEffect(() => {
    // StrictMode mounts twice in development. A second hand-back would issue
    // a second authorization code.
    if (hasStarted.current) {
      return;
    }
    hasStarted.current = true;

    authClient.oauth2
      .continue({ created: true, oauth_query: oauthQuery })
      .then((result) => {
        if (result.error || !(result.data?.redirect && result.data.url)) {
          setHasFailed(true);
        }
      })
      .catch(() => {
        setHasFailed(true);
      });
  });

  if (hasFailed) {
    return (
      <div role="alert" className="flex flex-1 flex-col gap-2 p-6">
        <h1 className="text-2xl font-light text-balance tracking-tight">
          {clientName
            ? t("errorTitleFor", { client: clientName })
            : t("errorTitle")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {clientName
            ? t("errorDescriptionFor", { client: clientName })
            : t("errorDescription")}
        </p>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="flex flex-1 items-center justify-center gap-2 p-6 text-sm text-muted-foreground"
    >
      <Loader2
        aria-hidden="true"
        className="size-4 animate-spin motion-reduce:animate-pulse"
      />
      {clientName ? t("continuingTo", { client: clientName }) : t("continuing")}
    </div>
  );
}
