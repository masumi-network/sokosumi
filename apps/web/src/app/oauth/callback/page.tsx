"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth/auth.client";

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

export default function OAuthCallbackPage() {
  const t = useTranslations("App.Account.OAuthCallback");
  const searchParams = useSearchParams();
  const [codeVerifier, setCodeVerifier] = useState(
    "mA875sdFqWFGNmJCv7mSPQ2N5l8eWI09-9-lsUB8cfo",
  );
  const [clientId, setClientId] = useState("IoecnYiAxHfEOGogPYzZDwdXTYAqYWLR");
  const [clientSecret, setClientSecret] = useState(
    "xwAtFNeOtVsShVneNanXZDINLMHLiijT",
  );
  const [isExchanging, setIsExchanging] = useState(false);
  const [tokenResponse, setTokenResponse] = useState<TokenResponse | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const oauthError = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  useEffect(() => {
    // Check for OAuth error in URL
    if (oauthError) {
      setError(
        errorDescription || oauthError || t("errors.authorizationFailed"),
      );
    }

    // Try to retrieve code verifier from sessionStorage using state parameter
    if (state && code && !codeVerifier) {
      const storedVerifier = sessionStorage.getItem(
        `oauth_code_verifier_${state}`,
      );
      if (storedVerifier) {
        setCodeVerifier(storedVerifier);
        // Clear it after retrieving
        sessionStorage.removeItem(`oauth_code_verifier_${state}`);
      }
    }
  }, [oauthError, errorDescription, t, state, code, codeVerifier]);

  async function handleTokenExchange() {
    if (!code) {
      setError(t("errors.missingCode"));
      return;
    }

    if (!codeVerifier.trim()) {
      setError(t("errors.missingCodeVerifier"));
      return;
    }

    if (!clientId.trim() || !clientSecret.trim()) {
      setError(t("errors.missingCredentials"));
      return;
    }

    setIsExchanging(true);
    setError(null);
    setTokenResponse(null);

    try {
      // Use Better Auth client for token exchange
      const result = await authClient.oauth2.token({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: "http://localhost:3000/foobar",
        code_verifier: codeVerifier,
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
        fetchOptions: {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        },
      });

      console.log("result", result);

      if (result.error) {
        setError(result.error.message || t("errors.tokenExchangeFailed"));
        setIsExchanging(false);
        return;
      }

      if (!result.data) {
        setError(t("errors.tokenExchangeFailed"));
        setIsExchanging(false);
        return;
      }

      // Map Better Auth response to TokenResponse format
      const tokenData: TokenResponse = {
        access_token: result.data.access_token,
        token_type: result.data.token_type,
        expires_in: result.data.expires_in,
        refresh_token: (result.data as { refresh_token?: string })
          .refresh_token,
        scope: result.data.scope,
        id_token: (result.data as { id_token?: string }).id_token,
      };

      setTokenResponse(tokenData);
      toast.success(t("success.tokenExchanged"));
    } catch (err) {
      console.error("Token exchange error:", err);
      setError(t("errors.tokenExchangeFailed"));
    } finally {
      setIsExchanging(false);
    }
  }

  function handleCopyToken() {
    if (tokenResponse?.access_token) {
      navigator.clipboard.writeText(tokenResponse.access_token);
      toast.success(t("success.tokenCopied"));
    }
  }

  function handleCopyRefreshToken() {
    if (tokenResponse?.refresh_token) {
      navigator.clipboard.writeText(tokenResponse.refresh_token);
      toast.success(t("success.refreshTokenCopied"));
    }
  }

  // Show error if OAuth error in URL
  if (oauthError) {
    return (
      <div className="container mx-auto max-w-2xl py-8">
        <Card>
          <CardHeader>
            <CardTitle>{t("error.title")}</CardTitle>
            <CardDescription>{t("error.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <p className="text-sm font-semibold">{t("error.errorCode")}</p>
              <p className="text-muted-foreground text-sm">{oauthError}</p>
              {errorDescription && (
                <>
                  <p className="text-sm font-semibold">
                    {t("error.errorDescription")}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {errorDescription}
                  </p>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show success if we have a token response
  if (tokenResponse?.access_token) {
    return (
      <div className="container mx-auto max-w-2xl py-8">
        <Card>
          <CardHeader>
            <CardTitle>{t("success.title")}</CardTitle>
            <CardDescription>{t("success.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t("success.accessToken")}</Label>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={tokenResponse.access_token}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopyToken}
                >
                  {t("actions.copy")}
                </Button>
              </div>
            </div>

            {tokenResponse.refresh_token && (
              <div className="space-y-2">
                <Label>{t("success.refreshToken")}</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={tokenResponse.refresh_token}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopyRefreshToken}
                  >
                    {t("actions.copy")}
                  </Button>
                </div>
              </div>
            )}

            {tokenResponse.expires_in && (
              <div className="space-y-2">
                <Label>{t("success.expiresIn")}</Label>
                <p className="text-muted-foreground text-sm">
                  {tokenResponse.expires_in} {t("success.seconds")}
                </p>
              </div>
            )}

            {tokenResponse.scope && (
              <div className="space-y-2">
                <Label>{t("success.scope")}</Label>
                <p className="text-muted-foreground text-sm">
                  {tokenResponse.scope}
                </p>
              </div>
            )}

            {tokenResponse.id_token && (
              <div className="space-y-2">
                <Label>{t("success.idToken")}</Label>
                <Input
                  readOnly
                  value={tokenResponse.id_token}
                  className="font-mono text-xs"
                />
              </div>
            )}

            <div className="bg-muted rounded-md p-4">
              <p className="text-muted-foreground text-sm">
                {t("success.warning")}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show form to exchange code
  return (
    <div className="container mx-auto max-w-2xl py-8">
      <Card>
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {code ? (
            <>
              <div className="space-y-2">
                <Label>{t("authorizationCode")}</Label>
                <Input readOnly value={code} className="font-mono text-xs" />
              </div>

              {state && (
                <div className="space-y-2">
                  <Label>{t("state")}</Label>
                  <Input readOnly value={state} className="font-mono text-xs" />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="code-verifier">{t("codeVerifierLabel")}</Label>
                <Input
                  id="code-verifier"
                  type="text"
                  value={codeVerifier}
                  onChange={(e) => setCodeVerifier(e.target.value)}
                  placeholder={t("codeVerifierPlaceholder")}
                  className="font-mono text-xs"
                />
                <p className="text-muted-foreground text-xs">
                  {t("codeVerifierHelp")}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="client-id">{t("clientIdLabel")}</Label>
                <Input
                  id="client-id"
                  type="text"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder={t("clientIdPlaceholder")}
                  className="font-mono text-xs"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="client-secret">{t("clientSecretLabel")}</Label>
                <Input
                  id="client-secret"
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder={t("clientSecretPlaceholder")}
                  className="font-mono text-xs"
                />
                <p className="text-muted-foreground text-xs">
                  {t("clientSecretHelp")}
                </p>
              </div>

              {error && (
                <div className="bg-destructive/10 rounded-md p-3">
                  <p className="text-destructive text-sm">{error}</p>
                </div>
              )}

              <Button
                type="button"
                onClick={handleTokenExchange}
                disabled={
                  isExchanging ||
                  !codeVerifier.trim() ||
                  !clientId.trim() ||
                  !clientSecret.trim()
                }
                className="w-full"
              >
                {isExchanging ? t("actions.exchanging") : t("actions.exchange")}
              </Button>
            </>
          ) : (
            <div className="bg-muted rounded-md p-4">
              <p className="text-muted-foreground text-sm">{t("noCode")}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
