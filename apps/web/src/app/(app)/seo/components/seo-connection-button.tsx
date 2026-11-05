"use client";

import { Check, Unplug } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  type SeoConnectionProvider,
  useSeoConnection,
} from "./use-seo-connection";

export function SeoConnectionButton({
  provider,
  onConnected,
}: {
  provider: SeoConnectionProvider;
  onConnected?: () => void;
}) {
  const t = useTranslations("App.Seo");
  const model = useSeoConnection(provider, onConnected);
  const { data } = model.status;
  const name = t(`statistics.${provider}`);
  if (model.status.isError)
    return (
      <div className="space-y-2">
        <p role="alert" className="text-muted-foreground text-sm">
          {t("connections.loadFailed")}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void model.status.refetch();
          }}
        >
          {t("retry")}
        </Button>
      </div>
    );
  if (data?.status === "unavailable")
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {t("connections.unavailable")}
      </p>
    );
  if (data?.status === "connected")
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm">
          <Check aria-hidden className="size-4" />
          {t("connections.connected", { provider: name })}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          loading={model.busy}
          aria-label={t("connections.disconnect", { provider: name })}
          title={t("connections.disconnect", { provider: name })}
          onClick={() => {
            void model.disconnect();
          }}
        >
          <Unplug aria-hidden className="size-4" />
        </Button>
      </div>
    );
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        loading={model.busy || model.status.isPending}
        disabled={model.status.isPending}
        onClick={() => {
          void model.connect();
        }}
      >
        {t("connections.connect", { provider: name })}
      </Button>
      {data?.status === "pending" ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("connections.pending")}
        </p>
      ) : null}
    </div>
  );
}
