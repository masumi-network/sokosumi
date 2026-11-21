import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { seoResultFormat } from "@/i18n/seo-result-messages";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
import { landingEngagementTest } from "./seo-performance-model";
import { SeoFoldSummary, SeoPeriod, SeoSection } from "./seo-shared";

type Comparison = NonNullable<ProjectSeoWorkspace["landingEngagementChange"]>;

export function SeoLandingEngagement({ change }: { change: Comparison }) {
  const t = useSeoResultTranslations("App.Seo.traffic.landingEngagement");
  const number = (value: number, signed = false) =>
    seoResultFormat.number(value, {
      maximumFractionDigits: 2,
      signDisplay: signed ? "exceptZero" : "auto",
    });
  const test = landingEngagementTest(change);
  const engagement = change.engagementSecondsPerSession;
  const rows = [
    { label: t("seconds"), values: engagement },
    { label: t("views"), values: change.viewsPerSession },
  ];
  return (
    <SeoSection
      lang="en"
      title={t("title")}
      description={t("scope", {
        count: change.pageCount,
        zone: change.timeZone,
      })}
    >
      {engagement.withinPageChange === 0 && engagement.mixChange !== 0 && (
        <p className="px-2 text-sm">{t("mixOnly")}</p>
      )}
      {test && <p className="px-2 text-sm font-medium">{t(test)}</p>}
      <details>
        <SeoFoldSummary>{t("comparisonEvidence")}</SeoFoldSummary>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("metric")}</TableHead>
              {/* Numbers align at the end so before and after compare digit by digit. */}
              <TableHead className="text-end">
                <SeoPeriod report {...change.before} />
              </TableHead>
              <TableHead className="text-end">
                <SeoPeriod report {...change.after} />
              </TableHead>
              <TableHead className="text-end">{t("within")}</TableHead>
              <TableHead className="text-end">{t("mix")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ label, values }) => (
              <TableRow key={label}>
                <TableHead scope="row">{label}</TableHead>
                <TableCell className="text-end tabular-nums">
                  {number(values.before)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {number(values.after)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {number(values.withinPageChange, true)}
                </TableCell>
                <TableCell className="text-end tabular-nums">
                  {number(values.mixChange, true)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="px-2 text-muted-foreground text-xs">
          {t("sessions", {
            before: number(change.before.sessions),
            after: number(change.after.sessions),
          })}
        </p>
      </details>
    </SeoSection>
  );
}
