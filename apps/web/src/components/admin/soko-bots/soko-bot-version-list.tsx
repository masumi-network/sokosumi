import Link from "next/link";
import { getTranslations } from "next-intl/server";

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
import type { SokoBotVersionDetail } from "@/lib/clients/generated/core";
import { ADMIN_SOKO_BOT_VERSIONS_ROUTE } from "@/lib/soko-bot/constants";

interface SokoBotVersionListProps {
  versions: SokoBotVersionDetail[];
}

export async function SokoBotVersionList({
  versions,
}: SokoBotVersionListProps) {
  const t = await getTranslations("App.Admin.SokoBots.Versions");

  function formatRegion(region: string | null): string {
    if (region === "eu") {
      return t("Values.eu");
    }
    if (region === "us") {
      return t("Values.us");
    }
    return region ?? t("Values.noRegion");
  }

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("List.version")}</TableHead>
            <TableHead>{t("List.model")}</TableHead>
            <TableHead>{t("List.region")}</TableHead>
            <TableHead className="text-right">{t("List.actions")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {versions.map((version) => (
            <TableRow key={version.id}>
              <TableCell className="min-w-64 whitespace-normal">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`${ADMIN_SOKO_BOT_VERSIONS_ROUTE}/${encodeURIComponent(version.id)}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {version.name}
                    </Link>
                    {version.isDefault ? (
                      <Badge>{t("State.default")}</Badge>
                    ) : null}
                    <Badge variant="outline">
                      {t(version.authored ? "State.authored" : "State.builtIn")}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground font-mono text-xs">
                    {version.id}
                  </p>
                  <p className="text-muted-foreground line-clamp-2 text-xs">
                    {version.summary}
                  </p>
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs">
                {version.model}
              </TableCell>
              <TableCell>{formatRegion(version.inferenceRegion)}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  <Button asChild size="sm" variant="ghost">
                    <Link
                      href={`${ADMIN_SOKO_BOT_VERSIONS_ROUTE}/${encodeURIComponent(version.id)}`}
                    >
                      {t("Actions.view")}
                    </Link>
                  </Button>
                  {version.authored ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link
                        href={`${ADMIN_SOKO_BOT_VERSIONS_ROUTE}/${encodeURIComponent(version.id)}?mode=edit`}
                      >
                        {t("Actions.edit")}
                      </Link>
                    </Button>
                  ) : null}
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={`${ADMIN_SOKO_BOT_VERSIONS_ROUTE}/new?from=${encodeURIComponent(version.id)}`}
                    >
                      {t("Actions.duplicate")}
                    </Link>
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
