"use client";

import { RotateCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SeoField, SeoSelect } from "./seo-form-fields";
import { SEO_DEFAULT_STATISTICS_DAYS } from "./seo-statistics-model";
import type { useSeoStatistics } from "./use-seo-statistics";

export type SeoStatisticsForm = ReturnType<typeof useSeoStatistics>;

/** The property a source reads: one listed property that does not cover the pages is not read. */
function seoReadProperty(form: SeoStatisticsForm) {
  return form.properties.data?.properties.find(
    (item) => item.id === form.propertyId,
  );
}

/**
 * The property settings of one connected Google source in the statistics
 * dialog. The account itself is in the accounts card above them.
 */
export function SeoStatisticsSource({
  form,
  focused,
}: {
  form: SeoStatisticsForm;
  /** The reader opened the dialog for this source. */
  focused: boolean;
}) {
  const t = useTranslations("App.Seo");
  const { provider } = form;
  const properties = form.properties.data;
  const id = `seo-statistics-property-${provider}`;
  const property = seoReadProperty(form);
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
    </section>
  );
}
