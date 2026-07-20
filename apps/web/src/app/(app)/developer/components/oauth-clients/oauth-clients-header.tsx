"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import type { OAuthClientsHeaderProps } from "./types";

export function OAuthClientsHeader({ onCreateClick }: OAuthClientsHeaderProps) {
  const t = useTranslations("App.Developer.OAuthClients");

  return (
    <CardHeader>
      <div className="flex items-center justify-between">
        <div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>
        <Button onClick={onCreateClick}>
          <Plus className="size-4" />
          {t("createButton")}
        </Button>
      </div>
    </CardHeader>
  );
}
