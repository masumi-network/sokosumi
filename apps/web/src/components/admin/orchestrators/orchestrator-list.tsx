"use client";

import { Bot } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AdminOrchestratorItem } from "@/lib/services/admin-orchestrator.service";

interface OrchestratorListProps {
  orchestrators: AdminOrchestratorItem[];
}

export function OrchestratorList({ orchestrators }: OrchestratorListProps) {
  const t = useTranslations("App.Admin.Orchestrators.OrchestratorList");

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm tabular-nums">
        {t("totalCount", { count: orchestrators.length })}
      </p>

      {orchestrators.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-4">{t("orchestrator")}</TableHead>
                <TableHead>{t("slug")}</TableHead>
                <TableHead>{t("caption")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orchestrators.map((orchestrator) => (
                <TableRow key={orchestrator.id}>
                  <TableCell className="pl-4">
                    <Link
                      href={`/admin/orchestrators/${orchestrator.id}`}
                      className="flex items-center gap-3 hover:underline"
                    >
                      <Avatar className="size-10 rounded-md">
                        <AvatarImage
                          src={orchestrator.image ?? undefined}
                          alt={orchestrator.name}
                          className="object-cover"
                        />
                        <AvatarFallback className="rounded-md">
                          <Bot className="size-4" />
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium">{orchestrator.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {orchestrator.slug}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {orchestrator.caption ?? "—"}
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
