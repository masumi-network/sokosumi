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
import { SeoConnectionButton } from "./seo-connection-button";
import { SeoField, SeoSelect } from "./seo-form-fields";
import { SEO_STATISTICS_PERIODS } from "./seo-statistics-model";
import { useSeoStatistics } from "./use-seo-statistics";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoStatisticsDialog({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const form = useSeoStatistics(model);
  const properties = form.properties.data;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !model.pending) model.setDialog(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("statistics.title")}</DialogTitle>
          <DialogDescription>{t("statistics.description")}</DialogDescription>
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
          {form.properties.isPending ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t("statistics.propertiesLoading")}
            </p>
          ) : form.properties.isError ? (
            <div role="alert">
              <p>{t("statistics.propertiesFailed")}</p>
              <Button
                type="button"
                variant="outline"
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
          ) : (
            <p className="text-muted-foreground text-sm">
              {t(
                properties?.status === "not_connected"
                  ? "statistics.notConnected"
                  : "statistics.noProperties",
              )}
            </p>
          )}
          {properties?.reason ? (
            <p className="text-muted-foreground text-sm">{properties.reason}</p>
          ) : null}
          <SeoConnectionButton
            key={form.provider}
            provider={form.provider}
            onConnected={() => {
              void form.properties.refetch();
            }}
          />
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
            <SeoField
              id="seo-statistics-channel"
              label={t("statistics.channel")}
            >
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
            <Button
              type="submit"
              loading={model.pending}
              disabled={
                model.pending ||
                !form.propertyId ||
                form.invalidDates ||
                !model.data.scope.pageIds.length ||
                !model.data.availableActions.canSyncMetrics
              }
            >
              {t("statistics.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
