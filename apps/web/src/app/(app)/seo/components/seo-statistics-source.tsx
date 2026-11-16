"use client";

import { RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SeoConnectionButton } from "./seo-connection-button";
import { SeoField, SeoSelect } from "./seo-form-fields";
import {
  SEO_DEFAULT_STATISTICS_DAYS,
  type SeoStatisticsProvider,
} from "./seo-statistics-model";
import { useSeoStatistics } from "./use-seo-statistics";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/**
 * One Google source in the statistics dialog: its name and what it measures,
 * its account control, and once connected, the property it reads.
 */
export function SeoStatisticsSource({
  model,
  provider,
  focused,
}: {
  model: SeoWorkspaceModel;
  provider: SeoStatisticsProvider;
  /** The reader opened the dialog for this source. */
  focused: boolean;
}) {
  const t = useTranslations("App.Seo");
  const form = useSeoStatistics(model, provider);
  const { connected } = form;
  const properties = form.properties.data;
  const id = `seo-statistics-property-${provider}`;
  // Only the property that is read: one listed property that does not cover the pages is not.
  const property = properties?.properties.find(
    (item) => item.id === form.propertyId,
  );
  // After an approval the saved answer still says "not connected" until the new read ends.
  const reading =
    form.properties.isPending ||
    (form.properties.isFetching && properties?.status === "not_connected");
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-focused={focused || undefined}
      aria-current={focused || undefined}
      tabIndex={focused ? -1 : undefined}
      className={cn(
        "space-y-3 rounded-lg border p-4",
        focused && "border-foreground",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-0.5">
          <h3 id={`${id}-title`} className="text-sm font-medium">
            {t(`statistics.${provider}`)}
          </h3>
          <p className="text-muted-foreground text-sm">
            {t(`statistics.measures.${provider}`)}
          </p>
        </div>
        <SeoConnectionButton
          provider={provider}
          variant={focused && !connected ? "primary" : "outline"}
          connectLabel={t("connections.connectShort")}
          compact
          accountDetail={property?.name}
        />
      </div>
      {connected ? (
        <div className="space-y-2 border-t pt-3">
          {reading ? (
            <p role="status" className="text-muted-foreground text-sm">
              {t("statistics.propertiesLoading")}
            </p>
          ) : form.propertiesUnavailable ? (
            <div role="alert" className="space-y-2">
              <p className="text-sm">{t("statistics.propertiesFailed")}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
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
            <p className="text-sm break-words">
              <span className="text-muted-foreground">
                {t("statistics.property")}:{" "}
              </span>
              {properties.properties[0].name}
              {property ? null : (
                // It does not cover the selected pages, so nothing is read from it.
                <span className="text-muted-foreground block">
                  {t("statistics.propertyNotMatching")}
                </span>
              )}
            </p>
          ) : properties?.properties.length ? (
            <SeoField id={id} label={t("statistics.property")}>
              <SeoSelect
                id={id}
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
              {t("statistics.noProperties")}
            </p>
          )}
          {properties?.reason ? (
            <p className="text-muted-foreground text-sm">{properties.reason}</p>
          ) : null}
          {property ? (
            // The period and the traffic are set: the reader has no range or channel to choose.
            <p
              className="text-muted-foreground text-sm"
              data-testid={`seo-statistics-reads-${provider}`}
            >
              {t(
                provider === "search_console"
                  ? "statistics.readsSearch"
                  : form.channel === "organic"
                    ? "statistics.readsOrganic"
                    : form.channel === "ai_assistant"
                      ? "statistics.readsAiAssistant"
                      : "statistics.readsAll",
                { days: SEO_DEFAULT_STATISTICS_DAYS },
              )}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
