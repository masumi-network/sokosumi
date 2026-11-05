"use client";

import { Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Asks for a link's password, then shows what it shares. */
export function SharedFilesPasswordForm({ token }: { token: string }) {
  const t = useTranslations("Share.Files");
  const router = useRouter();
  const inputId = useId();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<"wrong" | "locked" | "failed" | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="grid gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!password) return;
        setBusy(true);
        setError(null);
        try {
          const response = await fetch(
            `/share/files/${encodeURIComponent(token)}/unlock`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ password }),
            },
          );
          if (response.ok) {
            router.refresh();
            return;
          }
          setError(
            response.status === 429
              ? "locked"
              : response.status === 401 || response.status === 400
                ? "wrong"
                : "failed",
          );
        } catch {
          setError("failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Label htmlFor={inputId} className="flex items-center gap-1.5">
        <Lock aria-hidden className="size-3.5" />
        {t("passwordLabel")}
      </Label>
      <Input
        id={inputId}
        type="password"
        autoComplete="current-password"
        autoFocus
        value={password}
        aria-invalid={error === "wrong" || undefined}
        onChange={(event) => setPassword(event.target.value)}
      />
      {error ? (
        <p role="alert" className="text-semantic-destructive text-sm">
          {t(`errors.${error}`)}
        </p>
      ) : null}
      <Button type="submit" loading={busy} disabled={!password}>
        {t("open")}
      </Button>
    </form>
  );
}
