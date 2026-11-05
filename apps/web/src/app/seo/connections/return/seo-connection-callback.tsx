"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { SeoConnectionCallbackContext } from "@/lib/seo/connection-callback";
import { useSeoConnectionCallback } from "./use-seo-connection-callback";

export function SeoConnectionCallback({
  context,
}: {
  context: SeoConnectionCallbackContext | null;
}) {
  const t = useTranslations("App.Seo.connections");
  const model = useSeoConnectionCallback(context);
  const provider =
    context?.provider === "ga4" ? "Google Analytics" : "Search Console";
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-5 px-6 py-10">
      <h1 className="text-2xl font-semibold">{t("callbackTitle")}</h1>
      {model.busy ? (
        <p role="status" className="text-muted-foreground">
          {t("callbackWorking")}
        </p>
      ) : null}
      {model.connected ? <p role="status">{t("callbackDone")}</p> : null}
      {model.error ? (
        <p role="alert" className="text-destructive">
          {t(model.error, { provider })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {model.canRetry && context && !context.failed ? (
          <Button
            type="button"
            disabled={model.busy}
            onClick={() => {
              void model.complete();
            }}
          >
            {t("resume")}
          </Button>
        ) : null}
        <Button variant="outline" asChild>
          <Link href={context?.returnPath ?? "/seo"}>{t("returnToAudit")}</Link>
        </Button>
      </div>
    </main>
  );
}
