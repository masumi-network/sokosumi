"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import type { OAuthClientsHeaderProps } from "./types";

export function OAuthClientsHeader({ onCreateClick }: OAuthClientsHeaderProps) {
  const t = useTranslations("App.Account.OAuthClients");

  return (
    <CardHeader>
      {/* Phones stack the text above a full-width Create, so neither squeezes. */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </div>
        <Button onClick={onCreateClick} className="w-full md:w-auto">
          <Plus className="size-4" />
          {t("createButton")}
        </Button>
      </div>
    </CardHeader>
  );
}
