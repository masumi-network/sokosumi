"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { getMcpUrl } from "@/app/components/MCP/mcp-url";
import { McpUrlDisplay } from "@/app/components/MCP/mcp-url-display";
import { usePageListSearch } from "@/components/page-list-search";

export function McpActiveKeyView() {
  const t = useTranslations("App.MCP");

  const [url] = usePageListSearch([getMcpUrl()], (value) => ({
    primary: [t("urlLabel"), value],
    secondary: [t("docsLink"), t("existingKeyNote")],
  }));
  if (!url) return null;

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t("urlLabel")}</p>
      <McpUrlDisplay url={url} />
      <div className="text-muted-foreground text-sm">
        <Link
          href="https://www.masumi.network/dev/sokosumi/mcp"
          target="_blank"
          rel="noopener noreferrer"
          className="text-foreground inline-flex items-center gap-1 underline underline-offset-4"
        >
          {t("docsLink")}
          <ExternalLink className="size-3" />
        </Link>
      </div>
      <p className="text-muted-foreground text-xs">{t("existingKeyNote")}</p>
    </div>
  );
}
