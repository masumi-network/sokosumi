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
import type { Coworker } from "@/lib/clients/generated/core/types.gen";

interface CoworkersTableProps {
  coworkers: Coworker[];
}

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

  const filtered = useMemo(
    () => coworkers.filter((coworker) => matchesSearch(coworker, search)),
    [coworkers, search],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("searchPlaceholder")}
          className="max-w-sm"
          aria-label={t("searchPlaceholder")}
        />
        <p className="text-muted-foreground text-sm tabular-nums">
          {search.trim()
            ? t("filteredCount", {
                shown: filtered.length,
                total: coworkers.length,
              })
            : t("totalCount", { count: coworkers.length })}
        </p>
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {coworkers.length === 0 ? t("empty") : t("emptySearch")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("name")}</TableHead>
                <TableHead>{t("slug")}</TableHead>
                <TableHead>{t("caption")}</TableHead>
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
