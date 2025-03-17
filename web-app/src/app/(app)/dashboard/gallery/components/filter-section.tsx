"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import Tags from "./tags";

export default function FilterSection() {
  const t = useTranslations("App.Gallery.FilterSection");

  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold">{t("header")}</h1>

      <div className="flex flex-col gap-4 lg:flex-row">
        <Input
          className="h-12 max-w-64 min-w-36"
          placeholder={t("searchPlaceholder")}
        />
        <Tags tags={selectedTags} onChange={setSelectedTags} />
        <Button
          variant="ghost"
          onClick={() => {
            setSelectedTags([]);
          }}
          className="h-12 gap-2 text-lg"
        >
          {t("reset")}
          <X />
        </Button>
      </div>
    </div>
  );
}
