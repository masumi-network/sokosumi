"use client";

import { RefreshCw, RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
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
import {
  SEO_DEFAULT_STATISTICS_DAYS,
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
                <RotateCw />
                {t("retry")}
              </Button>
            </div>
          ) : properties?.properties.length === 1 ? (
            // One property: nothing to choose, so it is a line and not a field.
            <p className="text-sm">
              <span className="text-muted-foreground">
                {t("statistics.property")}:{" "}
              </span>
              {properties.properties[0].name}
            </p>
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
          {connectFirst || !properties?.properties.length ? null : (
            // The period and the traffic are set: the reader has no range or channel to choose.
            <p className="text-sm" data-testid="seo-statistics-reads">
              {t(
                form.provider === "search_console"
                  ? "statistics.readsSearch"
                  : form.channel === "organic"
                    ? "statistics.readsOrganic"
                    : "statistics.readsAll",
                { days: SEO_DEFAULT_STATISTICS_DAYS },
              )}
            </p>
          )}
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
                  !model.data.scope.pageIds.length ||
                  !model.data.availableActions.canSyncMetrics
                }
              >
                <RefreshCw />
                {t("statistics.submit")}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
