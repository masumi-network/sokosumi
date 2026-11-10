"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SignInError = "wrong" | "closed" | "failed";

/** Email, then the code sent to it. Nobody gets an account. */
export function RoomSignIn({ token }: { token: string }) {
  const t = useTranslations("Share.Room");
  const router = useRouter();
  const emailId = useId();
  const codeId = useId();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [error, setError] = useState<SignInError | null>(null);
  const [busy, setBusy] = useState(false);
  const base = `/share/rooms/${encodeURIComponent(token)}`;

  async function post(path: string, body: object): Promise<Response> {
    return fetch(`${base}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function handleEmail(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await post("code", { email });
      if (response.ok) setStep("code");
      else setError(response.status === 410 ? "closed" : "failed");
    } catch {
      setError("failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCode(event: React.FormEvent) {
    event.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await post("session", { email, code });
      if (response.ok) {
        router.refresh();
        return;
      }
      setError(
        response.status === 401 || response.status === 400
          ? "wrong"
          : response.status === 410
            ? "closed"
            : "failed",
      );
    } catch {
      setError("failed");
    } finally {
      setBusy(false);
    }
  }

  const errorText = error ? (
    <p role="alert" className="text-semantic-destructive text-sm">
      {t(`errors.${error}`)}
    </p>
  ) : null;

  if (step === "code")
    return (
      <form className="grid gap-3" onSubmit={handleCode}>
        <p className="text-muted-foreground text-sm">
          {t("codeSent", { email })}
        </p>
        <Label htmlFor={codeId}>{t("codeLabel")}</Label>
        <Input
          id={codeId}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={6}
          placeholder="123456"
          value={code}
          aria-invalid={error === "wrong" || undefined}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
        />
        {errorText}
        <Button type="submit" loading={busy} disabled={code.length < 6}>
          {t("open")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="justify-self-start"
          disabled={busy}
          onClick={() => {
            setStep("email");
            setCode("");
            setError(null);
          }}
        >
          {t("useAnotherEmail")}
        </Button>
      </form>
    );

  return (
    <form className="grid gap-3" onSubmit={handleEmail}>
      <p className="text-muted-foreground text-sm">{t("signInHint")}</p>
      <Label htmlFor={emailId}>{t("emailLabel")}</Label>
      <Input
        id={emailId}
        type="email"
        autoComplete="email"
        autoFocus
        placeholder="name@example.com"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      {errorText}
      <Button type="submit" loading={busy} disabled={!email.trim()}>
        {t("sendCode")}
      </Button>
    </form>
  );
}
