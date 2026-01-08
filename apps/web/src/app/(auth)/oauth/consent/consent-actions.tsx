"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/auth.client";

interface ConsentActionsProps {
  redirectUri: string;
}

export function ConsentActions({ redirectUri }: ConsentActionsProps) {
  const t = useTranslations("App.Account.OAuthConsent.actions");
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [isDenying, setIsDenying] = useState(false);

  async function handleAuthorize() {
    setIsAuthorizing(true);
    try {
      const result = await authClient.oauth2.consent({
        accept: true,
      });

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
    const result = await authClient.oauth2.consent({
      accept: false,
    });

    if (result.error) {
      toast.error(result.error.message || t("denyError"));
      setIsDenying(false);
      return;
    }

    if (result.data?.redirect) {
      window.location.href = result.data.uri;
    } else {
      window.location.href = redirectUri;
    }
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
