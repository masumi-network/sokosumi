"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { ApiKeysHeaderProps } from "./types";

/**
 * Header component for the API keys section
 * Contains title, description, and create button
 */
export function ApiKeysHeader({ onCreateClick }: ApiKeysHeaderProps) {
  const t = useTranslations("App.Account.ApiKeys");

  return (
    <CardHeader>
      <div className="flex items-center justify-between">
        <div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>
        <Button onClick={onCreateClick}>
          <Plus className="h-4 w-4" />
          {t("createButton")}
        </Button>
      </div>
    </CardHeader>
  );
}
