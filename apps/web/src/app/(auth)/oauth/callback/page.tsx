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
import { normalizeOAuthIssuerBase } from "@/lib/utils/oauth-issuer";

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
  const [codeVerifier, setCodeVerifier] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [isExchanging, setIsExchanging] = useState(false);
  const [tokenResponse, setTokenResponse] = useState<TokenResponse | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const issuerFromParams = searchParams.get("iss");
  const oauthError = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  useEffect(() => {
    // Check for OAuth error in URL
    if (oauthError) {
      setError(
        errorDescription || oauthError || t("errors.authorizationFailed"),
      );
    }
  }, [oauthError, errorDescription, t]);

  async function handleTokenExchange() {
    if (!code) {
      setError(t("errors.missingCode"));
      return;
    }

    if (!codeVerifier.trim()) {
      setError(t("errors.missingCodeVerifier"));
      return;
    }

    if (!clientId.trim()) {
      setError(t("errors.missingCredentials"));
      return;
    }

    setIsExchanging(true);
    setError(null);
    setTokenResponse(null);

    try {
      const redirectUri = `${window.location.origin}/oauth/callback`;
      // The token endpoint only accepts `application/x-www-form-urlencoded` (OAuth 2.1).
      // `authClient.oauth2.token()` sends JSON. The oauth-provider fetch plugin also
      // re-serializes POST bodies as JSON when `window.location.search` is set (this page),
      // so we POST with URLSearchParams via `fetch` instead of the Better Auth client.
      const expectedIssuerBase = normalizeOAuthIssuerBase(
        `${window.location.origin}/api/auth`,
      );
      if (!expectedIssuerBase) {
        setError(t("errors.tokenExchangeFailed"));
        return;
      }

      const issuerFromQuery = issuerFromParams?.trim().length
        ? normalizeOAuthIssuerBase(issuerFromParams)
        : expectedIssuerBase;

      if (!issuerFromQuery || issuerFromQuery !== expectedIssuerBase) {
        setError(t("errors.invalidIssuer"));
        return;
      }

      const tokenUrl = `${issuerFromQuery}/oauth2/token`;

      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier.trim(),
        client_id: clientId.trim(),
        scope: "openid",
      });
      if (clientSecret.trim()) {
        body.set("client_secret", clientSecret.trim());
      }

      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
      });

      const payload: unknown = await response.json().catch(() => null);
      const tokenPayload = payload as TokenResponse | null;

      if (!response.ok || tokenPayload?.error) {
        setError(
          tokenPayload?.error_description ||
            tokenPayload?.error ||
            t("errors.tokenExchangeFailed"),
        );
        return;
      }

      if (!tokenPayload?.access_token) {
        setError(t("errors.tokenExchangeFailed"));
        return;
      }

      const tokenData: TokenResponse = {
        access_token: tokenPayload.access_token,
        token_type: tokenPayload.token_type,
        expires_in: tokenPayload.expires_in,
        refresh_token: tokenPayload.refresh_token,
        scope: tokenPayload.scope,
        id_token: tokenPayload.id_token,
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
                  isExchanging || !codeVerifier.trim() || !clientId.trim()
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
