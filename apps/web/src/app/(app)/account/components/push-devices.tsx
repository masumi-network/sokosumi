"use client";

import {
  ChevronRight,
  CircleHelp,
  Loader2,
  Monitor,
  MonitorSmartphone,
  RefreshCw,
  Smartphone,
  Tablet,
  TriangleAlert,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { PushDevice } from "@/lib/clients/generated/core/types.gen";
import { cn } from "@/lib/utils";
import { usePushDevices } from "./use-push-devices";

interface PushDevicesProps {
  userId: string;
}

export function PushDevices({ userId }: PushDevicesProps) {
  const t = useTranslations("App.Account.PushDevices");
  const formatter = useFormatter();
  const [open, setOpen] = useState(false);
  const query = usePushDevices(userId, open);
  const disclosureRef = useRef<HTMLButtonElement>(null);
  const removeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const empty = query.data?.devices.length === 0;
  const showNotice = !query.isFetching && (query.isError || empty);

  function deviceLabel(device: PushDevice) {
    return device.browserDetails
      ? t("browserLabel", device.browserDetails)
      : t("deviceLabel", {
          platform: t(`platforms.${device.platform}`),
          formFactor: t(`formFactors.${device.formFactor}`),
        });
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="@container">
      <div className="flex items-center justify-between gap-2">
        <CollapsibleTrigger asChild>
          <Button
            ref={disclosureRef}
            type="button"
            variant="ghost"
            size="sm"
            className="group text-muted-foreground -ms-2 h-auto min-h-9 min-w-0 shrink justify-start gap-2 px-2 py-2 text-start font-normal whitespace-normal"
          >
            <ChevronRight
              className="size-4 shrink-0 group-data-[state=open]:rotate-90 motion-safe:transition-transform"
              aria-hidden="true"
            />
            {t("title")}
          </Button>
        </CollapsibleTrigger>
        {open ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground size-8 p-0 @sm:w-auto @sm:px-2.5"
            aria-label={t("refresh")}
            disabled={query.isFetching}
            aria-busy={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? (
              <Loader2
                className="size-3.5 motion-safe:animate-spin"
                aria-hidden="true"
              />
            ) : (
              <RefreshCw className="size-3.5" aria-hidden="true" />
            )}
            <span className="hidden @sm:inline">{t("refresh")}</span>
          </Button>
        ) : null}
      </div>
      <CollapsibleContent className="space-y-3 pt-2 pb-3">
        <div
          role="status"
          className={cn(
            showNotice
              ? "flex items-start gap-3 rounded-lg border p-4 text-sm"
              : "sr-only",
          )}
        >
          {query.isFetching ? (
            t("loading")
          ) : query.isError ? (
            <>
              <TriangleAlert
                className="text-semantic-warning mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <p className="leading-relaxed">{t("error")}</p>
            </>
          ) : empty ? (
            <>
              <MonitorSmartphone
                className="text-muted-foreground mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <div className="min-w-0 space-y-1">
                <p className="font-medium">{t("empty")}</p>
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {t("emptyHint")}
                </p>
              </div>
            </>
          ) : null}
        </div>
        {!query.isError && query.data && query.data.devices.length > 0 ? (
          <ul
            className="divide-y rounded-lg border"
            aria-busy={query.isFetching}
          >
            {query.data.devices.map((device) => {
              const DeviceIcon =
                device.formFactor === "phone"
                  ? Smartphone
                  : device.formFactor === "tablet"
                    ? Tablet
                    : device.formFactor === "desktop"
                      ? Monitor
                      : MonitorSmartphone;
              const hasDeliveryProblem =
                device.state === "failing" || device.state === "failed";
              const StatusIcon = hasDeliveryProblem
                ? TriangleAlert
                : CircleHelp;

              return (
                <li
                  key={device.id}
                  className="flex items-start gap-3 p-3 @sm:p-4"
                >
                  <div className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-md">
                    <DeviceIcon className="size-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="min-w-0 text-sm leading-5 font-medium wrap-anywhere">
                        {deviceLabel(device)}
                      </p>
                      {device.id === query.data?.currentDeviceId ? (
                        <Badge
                          variant="outline"
                          className="border-transparent bg-muted text-muted-foreground font-normal"
                        >
                          {t("thisDevice")}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-x-4 gap-y-1 @sm:flex-row @sm:flex-wrap @sm:items-center">
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
                      {device.state !== "active" ? (
                        <p
                          className={cn(
                            "flex items-center gap-1.5 text-xs leading-relaxed",
                            hasDeliveryProblem
                              ? "text-semantic-warning"
                              : "text-muted-foreground",
                          )}
                        >
                          <StatusIcon
                            className="size-3.5 shrink-0"
                            aria-hidden="true"
                          />
                          {t(`states.${device.state}`)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground -me-1 min-h-9 shrink-0 px-2 text-xs font-normal"
                    aria-label={t("removeNamedDevice", {
                      device: deviceLabel(device),
                    })}
                    disabled={query.isRemoving}
                    onClick={(event) => {
                      removeTriggerRef.current = event.currentTarget;
                      query.selectDevice(device);
                    }}
                  >
                    {t("remove")}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <p className="text-muted-foreground text-xs leading-relaxed text-pretty">
          {t("description")}
        </p>
      </CollapsibleContent>
      <AlertDialog
        open={query.selectedDevice !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) query.selectDevice(null);
        }}
      >
        <AlertDialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain motion-reduce:animate-none"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger = removeTriggerRef.current;
            (trigger?.isConnected ? trigger : disclosureRef.current)?.focus();
          }}
        >
          <AlertDialogHeader className="text-start">
            <AlertDialogTitle>{t("removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed wrap-anywhere">
              {query.selectedDevice
                ? t("removeDescription", {
                    device: deviceLabel(query.selectedDevice),
                  })
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p
            role="alert"
            className={cn(
              "text-destructive text-sm leading-relaxed",
              !query.removeFailed && "sr-only",
            )}
          >
            {query.removeFailed ? t("removeError") : null}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={query.isRemoving}>
              {t("cancel")}
            </AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={query.isRemoving}
              aria-busy={query.isRemoving}
              onClick={query.removeSelectedDevice}
            >
              {query.isRemoving ? (
                <Loader2
                  className="size-4 motion-safe:animate-spin"
                  aria-hidden="true"
                />
              ) : null}
              {t("removeConfirm")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Collapsible>
  );
}
