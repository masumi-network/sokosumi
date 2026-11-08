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
import { SeoSearchQueries } from "./seo-search-queries";
import {
  SeoDate,
  SeoEmpty,
  SeoPageLink,
  SeoSection,
  SeoSource,
  SeoState,
} from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoKeywords({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const rows = model.filteredKeywords;
  // A column no row has measured only repeats "Not available"; name it once instead.
  const shown = {
    volume: rows.some((row) => row.volume !== null),
    intent: rows.some((row) => row.intent !== null),
    observed: rows.some((row) => row.observedAt !== null),
    source: rows.some((row) => row.observationId || row.source !== "saved"),
  };
  const hidden = [
    shown.volume ? null : t("keywords.volume"),
    shown.intent ? null : t("keywords.intent"),
    shown.observed ? null : t("observed"),
  ].filter((label): label is string => label !== null);
  return (
    <div className="space-y-5">
      <div>
        <Label className="sr-only" htmlFor="seo-keyword-search">
          {t("search")}
        </Label>
        <Input
          id="seo-keyword-search"
          type="search"
          value={model.keywordSearch}
          onChange={(event) => model.setKeywordSearch(event.target.value)}
          placeholder={t("keywords.searchPlaceholder")}
        />
      </div>
      <SeoSearchQueries model={model} />
      <SeoSection
        title={t("keywords.title")}
        actions={
          model.data.availableActions.canEdit ? (
            <Button size="sm" onClick={() => model.setDialog("keyword")}>
              <Plus className="size-4" />
              {t("keywords.add")}
            </Button>
          ) : null
        }
      >
        <p className="text-muted-foreground px-2 pb-3 text-sm">
          {t("keywords.help")}
        </p>
        {rows.length ? (
          <div className={HOLDER_ITEM_CLASS}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("keywords.keyword")}</TableHead>
                  <TableHead>{t("keywords.market")}</TableHead>
                  {shown.volume ? (
                    <TableHead>{t("keywords.volume")}</TableHead>
                  ) : null}
                  <TableHead>{t("keywords.position")}</TableHead>
                  {shown.intent ? (
                    <TableHead>{t("keywords.intent")}</TableHead>
                  ) : null}
                  <TableHead>{t("keywords.priority")}</TableHead>
                  {shown.observed ? (
                    <TableHead>{t("observed")}</TableHead>
                  ) : null}
                  {shown.source ? <TableHead>{t("source")}</TableHead> : null}
                  <TableHead>
                    <span className="sr-only">{t("queries.rowActions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const target = model.data.pages.find(
                    (page) => page.id === row.targetPageId,
                  );
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="min-w-48 whitespace-normal">
                        <p className="font-medium break-words">
                          <bdi>{row.keyword}</bdi>
                        </p>
                        {row.pageUrl ? (
                          <SeoPageLink url={row.pageUrl} />
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            {t("keywords.anyPage")}
                          </span>
                        )}
                        {row.version > 0 ? (
                          <p className="text-muted-foreground mt-1 text-xs">
                            {t("keywords.target")}:{" "}
                            {target?.label ||
                              target?.url ||
                              t("keywords.anyPage")}
                          </p>
                        ) : null}
                        <div className="mt-1">
                          <SeoState>
                            {t(
                              row.saved
                                ? "keywords.saved"
                                : "keywords.discovered",
                            )}
                          </SeoState>
                        </div>
                      </TableCell>
                      <TableCell>
                        {row.countryCode} / {row.languageCode}
                        {row.device ? (
                          <div className="text-muted-foreground text-sm">
                            {t(`analysis.${row.device}`)}
                          </div>
                        ) : null}
                      </TableCell>
                      {shown.volume ? (
                        <TableCell className="tabular-nums">
                          {row.volume === null
                            ? t("none")
                            : format.number(row.volume)}
                        </TableCell>
                      ) : null}
                      <TableCell className="whitespace-normal tabular-nums">
                        {row.positionStatus === "ranked" &&
                        row.position !== null
                          ? format.number(row.position)
                          : row.positionStatus === "not_in_range"
                            ? row.checkedResults === null
                              ? t("keywords.notInRangeUnknown")
                              : t("keywords.notInRange", {
                                  count: row.checkedResults,
                                })
                            : t("keywords.unavailable")}
                      </TableCell>
                      {shown.intent ? (
                        <TableCell>{row.intent ?? t("none")}</TableCell>
                      ) : null}
                      <TableCell>{t(`priority.${row.priority}`)}</TableCell>
                      {shown.observed ? (
                        <TableCell>
                          <SeoDate value={row.observedAt} />
                        </TableCell>
                      ) : null}
                      {shown.source ? (
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
                      ) : null}
                      <TableCell>
                        {model.data.availableActions.canEdit ? (
                          <div className="flex flex-wrap justify-end gap-2">
                            {row.version > 0 ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={model.pending}
                                onClick={() => model.openKeywordEdit(row)}
                              >
                                {t("edit")}
                              </Button>
                            ) : null}
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={model.pending}
                              onClick={() => {
                                void model.toggleKeyword(row);
                              }}
                            >
                              {t(
                                row.saved ? "keywords.unsave" : "keywords.save",
                              )}
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {hidden.length ? (
              <p className="text-muted-foreground border-t px-4 py-2 text-xs">
                {t("unmeasuredColumns", { columns: format.list(hidden) })}
              </p>
            ) : null}
          </div>
        ) : (
          <SeoEmpty
            title={t("keywords.empty")}
            description={t("keywords.emptyBody")}
          />
        )}
      </SeoSection>
    </div>
  );
}
