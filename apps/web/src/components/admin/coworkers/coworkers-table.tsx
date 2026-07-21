"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export function CoworkersTable({ coworkers }: CoworkersTableProps) {
  const t = useTranslations("App.Admin.Coworkers.Table");

  if (coworkers.length === 0) {
    return <p className="text-muted-foreground text-sm">{t("empty")}</p>;
  }

  return (
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
          {coworkers.map((coworker) => (
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
  );
}
