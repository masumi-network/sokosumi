"use client";

import { useFormatter, useTranslations } from "next-intl";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  SEO_STACKED_TABLE_CLASS,
  SeoPageLink,
  SeoPeriod,
  SeoSection,
} from "./seo-shared";
import { seoAiAssistants } from "./seo-traffic-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Which AI assistants sent visitors to which page, from GA4's AI Assistant channel. */
export function SeoAiAssistants({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo.traffic");
  const format = useFormatter();
  const assistants = seoAiAssistants(model.data.aiAssistantPages);
  if (!assistants) return null;
  if (!assistants.rows.length)
    return (
      <p className="text-muted-foreground px-2 text-sm">{t("noAiData")}</p>
    );
  return (
    <SeoSection
      title={t("aiAssistants")}
      description={
        <>
          {t("aiAssistantsHelp")} · <SeoPeriod {...assistants.period} />
          {assistants.truncated ? ` · ${t("aiAssistantsTruncated")}` : null}
        </>
      }
    >
      <div className={HOLDER_ITEM_CLASS}>
        <Table className={SEO_STACKED_TABLE_CLASS}>
          <TableHeader>
            <TableRow>
              <TableHead>{t("assistant")}</TableHead>
              <TableHead>{t("landingPage")}</TableHead>
              <TableHead className="text-right">{t("sessions")}</TableHead>
              <TableHead className="text-right">
                {t("keyEventsShort")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {assistants.rows.map((row) => (
              <TableRow key={`${row.source}:${row.pageUrl}`}>
                <TableCell data-label={t("assistant")}>
                  <bdi>{row.source}</bdi>
                </TableCell>
                <TableCell
                  className="min-w-48 whitespace-normal"
                  data-label={t("landingPage")}
                >
                  <SeoPageLink url={row.pageUrl} />
                </TableCell>
                <TableCell
                  className="text-right tabular-nums"
                  data-label={t("sessions")}
                >
                  {format.number(row.sessions)}
                </TableCell>
                <TableCell
                  className="text-right tabular-nums"
                  data-label={t("keyEventsShort")}
                >
                  {format.number(row.keyEvents)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </SeoSection>
  );
}
