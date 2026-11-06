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

export function SeoKeywords({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const rows = model.filteredKeywords;
  return (
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
      <div className="px-2 pb-3">
        <Label className="sr-only" htmlFor="seo-keyword-search">
          {t("search")}
        </Label>
        <Input
          id="seo-keyword-search"
          type="search"
          value={model.keywordSearch}
          onChange={(event) => model.setKeywordSearch(event.target.value)}
          placeholder={t("search")}
        />
      </div>
      {rows.length ? (
        <div className={HOLDER_ITEM_CLASS}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("keywords.keyword")}</TableHead>
                <TableHead>{t("keywords.market")}</TableHead>
                <TableHead>{t("keywords.volume")}</TableHead>
                <TableHead>{t("keywords.position")}</TableHead>
                <TableHead>{t("keywords.intent")}</TableHead>
                <TableHead>{t("keywords.priority")}</TableHead>
                <TableHead>{t("observed")}</TableHead>
                <TableHead>{t("source")}</TableHead>
                <TableHead>
                  <span className="sr-only">{t("manage")}</span>
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
                    <TableCell className="tabular-nums">
                      {row.volume === null
                        ? t("none")
                        : format.number(row.volume)}
                    </TableCell>
                    <TableCell className="whitespace-normal tabular-nums">
                      {row.positionStatus === "ranked" && row.position !== null
                        ? format.number(row.position)
                        : row.positionStatus === "not_in_range"
                          ? row.checkedResults === null
                            ? t("keywords.notInRangeUnknown")
                            : t("keywords.notInRange", {
                                count: row.checkedResults,
                              })
                          : t("keywords.unavailable")}
                    </TableCell>
                    <TableCell>{row.intent ?? t("none")}</TableCell>
                    <TableCell>{t(`priority.${row.priority}`)}</TableCell>
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
                      {model.data.availableActions.canEdit ? (
                        <div className="flex flex-wrap gap-2">
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
                            {t(row.saved ? "keywords.unsave" : "keywords.save")}
                          </Button>
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <SeoEmpty
          title={t("keywords.empty")}
          description={t("keywords.emptyBody")}
        />
      )}
    </SeoSection>
  );
}
