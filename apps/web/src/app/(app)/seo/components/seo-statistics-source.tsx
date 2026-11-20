"use client";

import { RotateCw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SeoField, SeoSelect } from "./seo-form-fields";
import { SEO_DEFAULT_STATISTICS_DAYS } from "./seo-statistics-model";
import type { useSeoStatistics } from "./use-seo-statistics";

export type SeoStatisticsForm = ReturnType<typeof useSeoStatistics>;

/**
 * The property settings of one connected Google source in the statistics
 * dialog. The account itself is in the accounts card above them.
 */
export function SeoStatisticsSource({
  form,
  focused,
  chooseProperty = false,
}: {
  form: SeoStatisticsForm;
  /** The reader opened the dialog for this source. */
  focused: boolean;
  chooseProperty?: boolean;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const { provider, eligibleProperties } = form;
  const properties = form.properties.data;
  const propertyId =
    chooseProperty && !form.selectedPropertyId ? "" : form.propertyId;
  const id = `seo-statistics-property-${provider}`;
  // After an approval the saved answer still says "not connected" until the new read ends.
  const reading =
    form.properties.isPending ||
    (form.properties.isFetching && properties?.status === "not_connected");
  if (!form.connected) return null;
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-focused={focused || undefined}
      aria-current={focused || undefined}
      tabIndex={focused ? -1 : undefined}
      className={cn(
        "space-y-2 rounded-lg border p-3 outline-none",
        focused && "border-foreground",
      )}
    >
      <h3 id={`${id}-title`} className="text-sm font-medium">
        {t(`statistics.${provider}`)}
      </h3>
      <div className="space-y-2">
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
        ) : form.sitesWithoutProperty.length > 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("statistics.propertyNotMatching", {
              sites: format.list(form.sitesWithoutProperty),
            })}
          </p>
        ) : eligibleProperties.length === 1 && propertyId ? (
          // One property: nothing to choose, so it is a line and not a field.
          <p className="text-sm break-words">
            <span className="text-muted-foreground">
              {t("statistics.property")}:{" "}
            </span>
            {eligibleProperties[0].name}
          </p>
        ) : eligibleProperties.length > 0 ? (
          <SeoField id={id} label={t("statistics.property")}>
            <SeoSelect
              id={id}
              value={propertyId}
              onValueChange={form.setPropertyId}
              placeholder={t("statistics.chooseProperty")}
              required
              options={eligibleProperties.map((property) => ({
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
        {propertyId ? (
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
    </section>
  );
}
