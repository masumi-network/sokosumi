"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Generates a PKCE code verifier according to OAuth 2.1 spec.
 * Code verifier must be 43-128 characters, URL-safe base64 encoded random string.
 */
function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Generates a PKCE code challenge using S256 method (SHA256).
 * Code challenge = Base64url(SHA256(ASCII(code_verifier)))
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

interface PKCEValues {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

export function StartAuthorization() {
  const t = useTranslations("App.Account.OAuthStartAuthorization");
  const [open, setOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [pkceValues, setPkceValues] = useState<PKCEValues | null>(null);

  async function handleGeneratePKCE() {
    setIsGenerating(true);
    try {
      // Generate PKCE parameters for OAuth 2.1 authorization code flow with PKCE
      const verifier = generateCodeVerifier();
      const challenge = await generateCodeChallenge(verifier);
      const state = crypto.randomUUID();

      const values: PKCEValues = {
        codeVerifier: verifier,
        codeChallenge: challenge,
        state: state,
      };

      setPkceValues(values);

      // Log to console for debugging
      console.log("=== PKCE Debug Values ===");
      console.log("Code Verifier:", verifier);
      console.log("Code Challenge:", challenge);
      console.log("State:", state);
      console.log("Code Verifier Length:", verifier.length);
      console.log("Code Challenge Length:", challenge.length);

      toast.success(t("success"));
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to generate PKCE values";
      toast.error(errorMessage);
    } finally {
      setIsGenerating(false);
    }
  }

  function handleCopy(value: string, label: string) {
    navigator.clipboard.writeText(value);
    toast.success(`${label} copied to clipboard`);
  }

  function handleOpenChange(newOpen: boolean) {
    setOpen(newOpen);
    if (!newOpen) {
      // Reset when closing
      setTimeout(() => {
        setPkceValues(null);
      }, 300);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">{t("button")}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!pkceValues ? (
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm">
                {t("instructions")}
              </p>
              <Button
                onClick={handleGeneratePKCE}
                disabled={isGenerating}
                className="w-full"
              >
                {isGenerating ? t("generating") : t("generateButton")}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("codeVerifierLabel")}</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={pkceValues.codeVerifier}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handleCopy(
                        pkceValues.codeVerifier,
                        t("codeVerifierLabel"),
                      )
                    }
                  >
                    {t("copy")}
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                  {t("length", { length: pkceValues.codeVerifier.length })}
                </p>
              </div>

              <div className="space-y-2">
                <Label>{t("codeChallengeLabel")}</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={pkceValues.codeChallenge}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handleCopy(
                        pkceValues.codeChallenge,
                        t("codeChallengeLabel"),
                      )
                    }
                  >
                    {t("copy")}
                  </Button>
                </div>
                <p className="text-muted-foreground text-xs">
                  {t("length", { length: pkceValues.codeChallenge.length })}
                </p>
              </div>

              <div className="space-y-2">
                <Label>{t("stateLabel")}</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={pkceValues.state}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      handleCopy(pkceValues.state, t("stateLabel"))
                    }
                  >
                    {t("copy")}
                  </Button>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setPkceValues(null)}>
                  {t("generateNew")}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleOpenChange(false)}
                >
                  {t("close")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
