"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePushDevices } from "./use-push-devices";

interface PushDevicesProps {
  userId: string;
}

export function PushDevices({ userId }: PushDevicesProps) {
  const t = useTranslations("App.Account.PushDevices");
  const headingId = useId();
  const query = usePushDevices(userId);

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 id={headingId} className="text-sm font-medium">
            {t("title")}
          </h2>
          <p className="text-xs leading-relaxed">{t("description")}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t("refresh")}
        </Button>
      </div>
      <div role="status" className="text-sm">
        {query.isFetching
          ? t("loading")
          : query.isError
            ? t("error")
            : query.data?.devices.length === 0
              ? t("empty")
              : null}
      </div>
      {!query.isError && query.data && query.data.devices.length > 0 ? (
        <ul className="space-y-4" aria-busy={query.isFetching}>
          {query.data.devices.map((device) => (
            <li
              key={device.id}
              className="flex flex-wrap items-start justify-between gap-2"
            >
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">
                  {t("deviceLabel", {
                    platform: t(`platforms.${device.platform}`),
                    formFactor: t(`formFactors.${device.formFactor}`),
                  })}
                </p>
                <p className="text-xs break-all">
                  {t("deviceId", { id: device.id })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {device.id === query.data?.currentDeviceId ? (
                  <Badge variant="outline">{t("thisDevice")}</Badge>
                ) : null}
                <Badge variant="outline">{t(`states.${device.state}`)}</Badge>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
