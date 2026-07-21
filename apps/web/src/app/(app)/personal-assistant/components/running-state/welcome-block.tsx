"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

export function WelcomeBlock({ firstName }: { firstName: string | null }) {
  const t = useTranslations("App.Hermes.Running");
  const greeting = firstName
    ? `${t("emptyTitle")}, ${firstName}`
    : t("emptyTitle");

  // The orchestrator's welcome typically lands within ~2s of arriving here
  // (it's bundled into the instance "ready" response). Showing the empty
  // greeting immediately and then replacing it with the real welcome reads
  // as a glitch — hold the empty state for a moment so it only renders if
  // there's a true cold start with no welcome incoming.
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), 2_500);
    return () => window.clearTimeout(t);
  }, []);
  if (!show) return null;

  return (
    <div className="mt-[-80px] flex h-full flex-col items-center justify-center px-6">
      <div className="mx-auto w-full max-w-xl text-center">
        <h1 className="text-foreground text-3xl font-semibold tracking-tight md:text-4xl">
          {greeting}
        </h1>
        <p className="text-muted-foreground mt-4 text-base leading-relaxed">
          {t("emptyHint")}
        </p>
      </div>
    </div>
  );
}
