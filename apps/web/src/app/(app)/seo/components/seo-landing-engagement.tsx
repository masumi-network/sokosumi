import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SeoPeriod, SeoSection } from "./seo-shared";

type Comparison = NonNullable<ProjectSeoWorkspace["landingEngagementChange"]>;

export function SeoLandingEngagement({ change }: { change: Comparison }) {
  const t = useTranslations("App.Seo.traffic.landingEngagement");
  const format = useFormatter();
  const number = (value: number, signed = false) =>
    format.number(value, {
      maximumFractionDigits: 2,
      signDisplay: signed ? "exceptZero" : "auto",
    });
  const engagement = change.engagementSecondsPerSession;
  const rows = [
    { label: t("seconds"), values: engagement },
    { label: t("views"), values: change.viewsPerSession },
  ];
  return (
    <SeoSection
      title={t("title")}
      description={t("scope", {
        count: change.pageCount,
        zone: change.timeZone,
      })}
    >
      {engagement.withinPageChange === 0 && engagement.mixChange !== 0 && (
        <p className="px-2 text-sm">{t("mixOnly")}</p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("metric")}</TableHead>
            <TableHead>
              <SeoPeriod {...change.before} />
            </TableHead>
            <TableHead>
              <SeoPeriod {...change.after} />
            </TableHead>
            <TableHead>{t("within")}</TableHead>
            <TableHead>{t("mix")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ label, values }) => (
            <TableRow key={label}>
              <TableHead scope="row">{label}</TableHead>
              <TableCell>{number(values.before)}</TableCell>
              <TableCell>{number(values.after)}</TableCell>
              <TableCell>{number(values.withinPageChange, true)}</TableCell>
              <TableCell>{number(values.mixChange, true)}</TableCell>
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
    </SeoSection>
  );
}
