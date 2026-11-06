"use client";

import { Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  SeoDate,
  SeoEmpty,
  SeoPageLink,
  SeoSection,
  SeoSource,
  SeoState,
} from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoCompetitors({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const rows = model.filteredCompetitors;
  const number = (value: number | null) =>
    value === null ? t("none") : format.number(value);
  return (
    <SeoSection
      title={t("competitors.title")}
      actions={
        model.data.availableActions.canEdit ? (
          <Button size="sm" onClick={() => model.setDialog("competitor")}>
            <Plus className="size-4" />
            {t("competitors.add")}
          </Button>
        ) : null
      }
    >
      <p className="text-muted-foreground px-2 pb-3 text-sm">
        {t("competitors.help")}
      </p>
      <div className="px-2 pb-3">
        <Label htmlFor="seo-competitor-search" className="sr-only">
          {t("search")}
        </Label>
        <Input
          id="seo-competitor-search"
          type="search"
          value={model.competitorSearch}
          onChange={(event) => model.setCompetitorSearch(event.target.value)}
          placeholder={t("search")}
        />
      </div>
      {rows.length ? (
        <div className={HOLDER_ITEM_CLASS}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("url")}</TableHead>
                <TableHead>{t("competitors.rank")}</TableHead>
                <TableHead>{t("competitors.backlinks")}</TableHead>
                <TableHead>{t("competitors.domains")}</TableHead>
                <TableHead>{t("observed")}</TableHead>
                <TableHead>{t("source")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("manage")}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="min-w-56 whitespace-normal">
                    <SeoPageLink url={row.url} />
                    <div className="mt-1">
                      <SeoState>
                        {t(
                          row.role === "page"
                            ? "competitors.yourPage"
                            : row.confirmed
                              ? "competitors.confirmed"
                              : "competitors.suggested",
                        )}
                      </SeoState>
                    </div>
                    {row.exclusionReason ? (
                      <p className="text-muted-foreground mt-2 text-sm">
                        {row.exclusionReason}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {number(row.rank)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {number(row.backlinks)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {number(row.referringDomains)}
                  </TableCell>
                  <TableCell>
                    <SeoDate value={row.observedAt} />
                  </TableCell>
                  <TableCell>
                    <span className="text-muted-foreground text-sm">
                      {row.source}
                    </span>
                    {row.observationId ? (
                      <div>
                        <SeoSource
                          workspace={model.data}
                          observationId={row.observationId}
                        />
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    {model.data.availableActions.canEdit &&
                    row.role === "competitor" &&
                    (row.canConfirm || row.confirmed) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={model.pending}
                        onClick={() => {
                          void model.toggleCompetitor(row);
                        }}
                      >
                        {t(
                          row.confirmed
                            ? "competitors.unconfirm"
                            : "competitors.confirm",
                        )}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <SeoEmpty
          title={t("competitors.empty")}
          description={t("competitors.emptyBody")}
        />
      )}
    </SeoSection>
  );
}
