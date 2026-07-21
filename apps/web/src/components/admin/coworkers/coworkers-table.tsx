"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Coworker } from "@/lib/clients/generated/core/types.gen";

interface CoworkersTableProps {
  coworkers: Coworker[];
}

type ArchiveFilter = "all" | "active" | "archived";

const CAPTION_MAX_LENGTH = 80;

function truncateCaption(caption: string | null | undefined): string {
  if (!caption) {
    return "—";
  }

  if (caption.length <= CAPTION_MAX_LENGTH) {
    return caption;
  }

  return `${caption.slice(0, CAPTION_MAX_LENGTH - 1)}…`;
}

function isArchived(coworker: Coworker): boolean {
  return coworker.archivedAt != null;
}

function matchesArchiveFilter(
  coworker: Coworker,
  archiveFilter: ArchiveFilter,
): boolean {
  if (archiveFilter === "all") {
    return true;
  }

  if (archiveFilter === "archived") {
    return isArchived(coworker);
  }

  return !isArchived(coworker);
}

function matchesSearch(coworker: Coworker, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }

  const haystack = [
    coworker.name,
    coworker.slug,
    coworker.caption ?? "",
    coworker.vendor.name,
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

export function CoworkersTable({ coworkers }: CoworkersTableProps) {
  const t = useTranslations("App.Admin.Coworkers.Table");
  const [search, setSearch] = useState("");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("all");

  const filtered = useMemo(
    () =>
      coworkers.filter(
        (coworker) =>
          matchesArchiveFilter(coworker, archiveFilter) &&
          matchesSearch(coworker, search),
      ),
    [archiveFilter, coworkers, search],
  );

  const archiveFilterLabel =
    archiveFilter === "all"
      ? t("filterAll")
      : archiveFilter === "active"
        ? t("filterActive")
        : t("filterArchived");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("searchPlaceholder")}
            className="max-w-sm"
            aria-label={t("searchPlaceholder")}
          />
          <ToggleGroup
            type="single"
            value={archiveFilter}
            onValueChange={(value) => {
              if (value) {
                setArchiveFilter(value as ArchiveFilter);
              }
            }}
            aria-label={t("archiveFilterLabel")}
          >
            <ToggleGroupItem value="all" aria-label={t("filterAll")}>
              {t("filterAll")}
            </ToggleGroupItem>
            <ToggleGroupItem value="active" aria-label={t("filterActive")}>
              {t("filterActive")}
            </ToggleGroupItem>
            <ToggleGroupItem value="archived" aria-label={t("filterArchived")}>
              {t("filterArchived")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <p className="text-muted-foreground text-sm tabular-nums">
          {search.trim() || archiveFilter !== "all"
            ? t("filteredCount", {
                shown: filtered.length,
                total: coworkers.length,
              })
            : t("totalCount", { count: coworkers.length })}
          {archiveFilter !== "all" ? (
            <span className="sr-only">{archiveFilterLabel}</span>
          ) : null}
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {coworkers.length === 0
            ? t("empty")
            : search.trim()
              ? t("emptySearch")
              : t("emptyFilter")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("name")}</TableHead>
                <TableHead>{t("slug")}</TableHead>
                <TableHead>{t("caption")}</TableHead>
                <TableHead>{t("status")}</TableHead>
                <TableHead>{t("whitelist")}</TableHead>
                <TableHead className="text-right tabular-nums">
                  {t("priority")}
                </TableHead>
                <TableHead className="text-right">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((coworker) => (
                <TableRow key={coworker.id}>
                  <TableCell className="font-medium">{coworker.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {coworker.slug}
                  </TableCell>
                  <TableCell className="text-muted-foreground max-w-xs truncate">
                    {truncateCaption(coworker.caption)}
                  </TableCell>
                  <TableCell>
                    {isArchived(coworker) ? (
                      <Badge variant="secondary">{t("archived")}</Badge>
                    ) : (
                      <Badge variant="outline">{t("active")}</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={coworker.isWhitelisted ? "default" : "secondary"}
                    >
                      {coworker.isWhitelisted
                        ? t("whitelisted")
                        : t("notWhitelisted")}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {coworker.priority}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/admin/coworkers/${coworker.id}`}>
                        {t("edit")}
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
