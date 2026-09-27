"use client";

import { ChevronRight, RefreshCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { usePushDevices } from "./use-push-devices";

interface PushDevicesProps {
  userId: string;
}

export function PushDevices({ userId }: PushDevicesProps) {
  const t = useTranslations("App.Account.PushDevices");
  const formatter = useFormatter();
  const [open, setOpen] = useState(false);
  const query = usePushDevices(userId, open);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="@container">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="group text-muted-foreground -ms-2 h-auto min-h-9 gap-2 px-2 py-2 font-normal"
        >
          <ChevronRight
            className="size-4 shrink-0 group-data-[state=open]:rotate-90 motion-safe:transition-transform"
            aria-hidden="true"
          />
          {t("title")}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="ms-7 space-y-3 pt-2 pb-3">
        <div className="flex flex-col items-start gap-2 @sm:flex-row @sm:justify-between">
          <p className="text-muted-foreground min-w-0 flex-1 text-xs leading-relaxed">
            {t("description")}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
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
                    {device.browserDetails
                      ? t("browserLabel", device.browserDetails)
                      : t("deviceLabel", {
                          platform: t(`platforms.${device.platform}`),
                          formFactor: t(`formFactors.${device.formFactor}`),
                        })}
                  </p>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    {device.registeredAt ? (
                      <time dateTime={device.registeredAt.toISOString()}>
                        {t("registeredAt", {
                          date: formatter.dateTime(
                            device.registeredAt,
                            "dateTimeMedium",
                          ),
                        })}
                      </time>
                    ) : (
                      t("registrationDateUnavailable")
                    )}
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
      </CollapsibleContent>
    </Collapsible>
  );
}
