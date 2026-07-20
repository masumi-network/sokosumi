"use client";

import { BookOpen, Code2, ExternalLink, Plug } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const DOCS_LINKS = [
  {
    key: "gettingStarted" as const,
    href: "https://www.masumi.network/dev/sokosumi/documentation",
    Icon: BookOpen,
  },
  {
    key: "apiReference" as const,
    href: "https://www.masumi.network/dev/sokosumi/api-reference",
    Icon: Code2,
  },
  {
    key: "mcp" as const,
    href: "https://www.masumi.network/dev/sokosumi/mcp",
    Icon: Plug,
  },
];

export function DocsSection() {
  const t = useTranslations("App.Developer.Docs");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {DOCS_LINKS.map(({ key, href, Icon }) => (
            <li key={key}>
              <Link
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:bg-muted/50 flex items-center gap-3 rounded-lg border p-4 transition-colors"
              >
                <Icon className="text-muted-foreground size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {t(`links.${key}.title`)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t(`links.${key}.description`)}
                  </p>
                </div>
                <ExternalLink className="text-muted-foreground size-4 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
