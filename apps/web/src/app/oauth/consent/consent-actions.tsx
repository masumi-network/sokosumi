"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/auth.client";

interface ConsentActionsProps {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  state?: string;
}

export function ConsentActions({
  clientId,
  redirectUri,
  codeChallenge,
  scopes,
  state,
}: ConsentActionsProps) {
  const t = useTranslations("App.Account.OAuthConsent.actions");
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [isDenying, setIsDenying] = useState(false);

  async function handleAuthorize() {
    setIsAuthorizing(true);
    try {
      const result = await authClient.oauth2.consent({
        accept: true, // required
        // scope: scopes.join(" "),
      });
      console.log("result", result);

      if (result.error) {
        toast.error(result.error.message || t("authorizeError"));
        setIsAuthorizing(false);
        return;
      }

      // Redirect to the authorization URL returned by Better Auth
      if (result.data?.redirect) {
        window.location.href = result.data.uri;
      } else {
        // Fallback: redirect to the client's redirect URI
        window.location.href = redirectUri;
      }
    } catch (error) {
      console.error("OAuth authorization error:", error);
      toast.error(t("authorizeErrorGeneric"));
      setIsAuthorizing(false);
    }
  }

  async function handleDeny() {
    setIsDenying(true);
    // Redirect back with access_denied error
    const denyUrl = new URL(redirectUri);
    denyUrl.searchParams.set("error", "access_denied");
    if (state) {
      denyUrl.searchParams.set("state", state);
    }
    window.location.href = denyUrl.toString();
  }

  return (
    <div className="space-y-2 pt-4">
      <Button
        type="button"
        variant="primary"
        className="w-full"
        onClick={handleAuthorize}
        disabled={isAuthorizing || isDenying}
      >
        {isAuthorizing ? t("authorizing") : t("authorize")}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleDeny}
        disabled={isAuthorizing || isDenying}
      >
        {isDenying ? t("denying") : t("deny")}
      </Button>
    </div>
  );
}
