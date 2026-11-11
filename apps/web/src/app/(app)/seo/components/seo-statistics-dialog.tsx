"use client";

import { useTranslations } from "next-intl";
import { PerformanceDateRange } from "@/components/performance/performance-date-range";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { SeoConnectionButton } from "./seo-connection-button";
import { SeoField, SeoSelect } from "./seo-form-fields";
import { SEO_CHOSEN_CLASS } from "./seo-shared";
import {
  SEO_STATISTICS_PERIODS,
  type SeoStatisticsProvider,
} from "./seo-statistics-model";
import { useSeoStatistics } from "./use-seo-statistics";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoStatisticsDialog({
  model,
  source,
}: {
  model: SeoWorkspaceModel;
  source?: SeoStatisticsProvider;
}) {
  const t = useTranslations("App.Seo");
  const form = useSeoStatistics(model, source);
  const properties = form.properties.data;
  // No account for this source yet: the dialog is the connect step. The sync fields follow the approval.
  // After the approval the saved answer still says "not connected" until the new read ends.
  const reading =
    form.properties.isPending ||
    (form.properties.isFetching && properties?.status === "not_connected");
  const connectFirst = properties?.status === "not_connected" && !reading;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !model.pending) model.setDialog(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(connectFirst ? "statistics.connectTitle" : "statistics.title")}
          </DialogTitle>
          <DialogDescription>
            {connectFirst
              ? t("statistics.connectFirst", {
                  provider: t(`statistics.${form.provider}`),
                })
              : t("statistics.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.submit();
          }}
        >
          <SeoField
            id="seo-statistics-provider"
            label={t("statistics.provider")}
          >
            <SeoSelect
              id="seo-statistics-provider"
              value={form.provider}
              onValueChange={form.changeProvider}
              options={["ga4", "search_console"].map((value) => ({
                value,
                label: t(`statistics.${value}`),
              }))}
            />
          </SeoField>
          {reading ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t("statistics.propertiesLoading")}
            </p>
          ) : form.propertiesUnavailable ? (
            <div role="alert">
              <p>{t("statistics.propertiesFailed")}</p>
              <Button
                type="button"
                variant="outline"
                loading={form.properties.isFetching}
                onClick={() => {
                  void form.properties.refetch();
                }}
              >
                {t("retry")}
              </Button>
            </div>
          ) : properties?.properties.length ? (
            <SeoField
              id="seo-statistics-property"
              label={t("statistics.property")}
            >
              <SeoSelect
                id="seo-statistics-property"
                value={form.propertyId}
                onValueChange={form.setPropertyId}
                placeholder={t("statistics.chooseProperty")}
                required
                options={properties.properties.map((property) => ({
                  value: property.id,
                  label: property.name,
                }))}
              />
            </SeoField>
          ) : connectFirst ? null : (
            <p className="text-muted-foreground text-sm">
              {t("statistics.noProperties")}
            </p>
          )}
          {properties?.reason && !connectFirst ? (
            <p className="text-muted-foreground text-sm">{properties.reason}</p>
          ) : null}
          <SeoConnectionButton
            key={form.provider}
            provider={form.provider}
            variant={connectFirst ? "primary" : "outline"}
            onConnected={() => {
              void form.properties.refetch();
            }}
          />
          {connectFirst ? null : <SeoStatisticsPeriod form={form} />}
          <p className="text-muted-foreground text-sm">
            {t("statistics.ownerOnly")}
          </p>
          {model.data.sharing === "organization" ? (
            <p className="text-muted-foreground text-sm">
              {t("statistics.shared")}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={model.pending}
              onClick={() => model.setDialog(null)}
            >
              {t("cancel")}
            </Button>
            {connectFirst ? null : (
              <Button
                type="submit"
                loading={model.pending}
                disabled={
                  model.pending ||
                  form.propertiesUnavailable ||
                  !form.propertyId ||
                  form.invalidDates ||
                  !model.data.scope.pageIds.length ||
                  !model.data.availableActions.canSyncMetrics
                }
              >
                {t("statistics.submit")}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The period and, for Google Analytics, the traffic channel of one sync. */
function SeoStatisticsPeriod({
  form,
}: {
  form: ReturnType<typeof useSeoStatistics>;
}) {
  const t = useTranslations("App.Seo");
  return (
    <>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={t("period")}
      >
        {SEO_STATISTICS_PERIODS.map((days) => (
          <Button
            key={days}
            type="button"
            variant="outline"
            size="sm"
            aria-pressed={form.preset === days}
            // The same mark as the chosen metric tile on the Traffic tab.
            className={cn(form.preset === days && SEO_CHOSEN_CLASS)}
            onClick={() => form.setPeriod(days)}
          >
            {t("statistics.lastDays", { days })}
          </Button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <PerformanceDateRange
          idPrefix="seo-statistics-period"
          from={form.from}
          until={form.to}
          fromLabel={t("statistics.from")}
          untilLabel={t("statistics.to")}
          invalid={form.invalidDates}
          onFromChange={form.setFrom}
          onUntilChange={form.setTo}
        />
      </div>
      {form.invalidDates ? (
        <p role="alert" className="text-destructive text-sm">
          {t("statistics.invalidDates")}
        </p>
      ) : null}
      {form.provider === "ga4" ? (
        <SeoField id="seo-statistics-channel" label={t("statistics.channel")}>
          <SeoSelect
            id="seo-statistics-channel"
            value={form.channel}
            onValueChange={(value) => {
              if (value === "all" || value === "organic")
                form.setChannel(value);
            }}
            options={[
              { value: "all", label: t("statistics.channelAll") },
              { value: "organic", label: t("statistics.channelOrganic") },
            ]}
          />
        </SeoField>
      ) : null}
    </>
  );
}
