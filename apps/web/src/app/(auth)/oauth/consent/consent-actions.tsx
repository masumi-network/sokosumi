"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ensureOAuthWorkspaceAction } from "@/lib/actions/workspace-gate/action";
import { authClient } from "@/lib/auth/auth.client";

interface ConsentActionsProps {
  oauthQuery?: string;
}

export function ConsentActions({ oauthQuery }: ConsentActionsProps) {
  const t = useTranslations("App.Account.OAuthConsent.actions");
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [isDenying, setIsDenying] = useState(false);

  async function handleAuthorize() {
    setIsAuthorizing(true);
    try {
      const workspaceResult = await ensureOAuthWorkspaceAction({});
      if (!workspaceResult.ok) {
        toast.error(t("workspacePrepareError"));
        setIsAuthorizing(false);
        return;
      }

      const result = await authClient.oauth2.consent({
        accept: true,
        ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
      });

      if (result.error) {
        toast.error(result.error.message || t("authorizeError"));
        setIsAuthorizing(false);
        return;
      }

      toast.success(t("authorizeSuccess"));
      // Keep the buttons disabled until the page leaves. Better Auth's client
      // already follows `{ redirect: true, url }`; navigating again would
      // deliver the code twice, and a confidential client such as CMO would
      // exchange it twice, which makes Core revoke the tokens.
      if (!(result.data.redirect && result.data.url)) {
        window.location.href = "/";
      }
    } catch (error) {
      console.error("OAuth authorization error:", error);
      toast.error(t("authorizeErrorGeneric"));
      setIsAuthorizing(false);
    }
  }

  async function handleDeny() {
    setIsDenying(true);
    try {
      const result = await authClient.oauth2.consent({
        accept: false,
        ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
      });

      if (result.error) {
        toast.error(result.error.message || t("denyError"));
        setIsDenying(false);
        return;
      }

      // Better Auth's client follows the redirect back to the client.
      if (result.data.redirect && result.data.url) {
        return;
      }
    } catch (error) {
      console.error("OAuth deny error:", error);
    }

    toast.error(t("denyError"));
    setIsDenying(false);
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
