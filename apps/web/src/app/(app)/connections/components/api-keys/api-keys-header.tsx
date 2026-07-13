"use client";

import { ExternalLink, Plus } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import type { ApiKeysHeaderProps } from "./types";

export function ApiKeysHeader({ onCreateClick }: ApiKeysHeaderProps) {
  const t = useTranslations("App.Account.ApiKeys");

  return (
    <CardHeader>
      <div className="flex items-center justify-between">
        <div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription className="space-y-1">
            <div>{t("description")}</div>
            <div>
              <Link
                href="https://www.masumi.network/dev/sokosumi/api-reference"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-sm underline underline-offset-4"
              >
                {t("apiDocsLink")}
                <ExternalLink className="size-3" />
              </Link>
            </div>
          </CardDescription>
        </div>
        <Button onClick={onCreateClick}>
          <Plus className="size-4" />
          {t("createButton")}
        </Button>
      </div>
    </CardHeader>
  );
}
