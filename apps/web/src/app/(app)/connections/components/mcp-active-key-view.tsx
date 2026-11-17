"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { getMcpUrl } from "@/app/components/MCP/mcp-url";
import { McpUrlDisplay } from "@/app/components/MCP/mcp-url-display";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function McpActiveKeyView() {
  const t = useTranslations("App.MCP");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("urlLabel")}</CardTitle>
        <CardDescription>{t("existingKeyNote")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <McpUrlDisplay url={getMcpUrl()} />
        <Link
          href="https://www.masumi.network/dev/sokosumi/mcp"
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground inline-flex items-center gap-1 text-sm underline underline-offset-4"
        >
          {t("docsLink")}
          <ExternalLink className="size-3" aria-hidden />
        </Link>
      </CardContent>
    </Card>
  );
}
