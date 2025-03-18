"use client";

import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { useDebouncedCallback } from "use-debounce";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KEYBOARD_INPUT_DEBOUNCE_TIME } from "@/constants";

import Tags from "./tags";

export default function FilterSection() {
  const t = useTranslations("App.Gallery.FilterSection");

  const { replace } = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState<string>(searchParams.get("query") ?? "");
  const [selectedTags, setSelectedTags] = useState<string[]>(
    searchParams.get("tags")?.split(",") ?? [],
  );

  const handleSearch = useCallback(
    (query: string, tags: string[]) => {
      const params = new URLSearchParams(searchParams);
      if (query) params.set("query", query);
      else params.delete("query");
      if (tags.length > 0) params.set("tags", tags.join(","));
      else params.delete("tags");
      replace(`${pathname}?${params.toString()}`);
    },
    [pathname, searchParams, replace],
  );

  const debouncedHandleSearch = useDebouncedCallback(
    handleSearch,
    KEYBOARD_INPUT_DEBOUNCE_TIME,
  );

  const handleReset = () => {
    setQuery("");
    setSelectedTags([]);
    replace(pathname);
  };

  useEffect(() => {
    debouncedHandleSearch(query, selectedTags);
    return () => debouncedHandleSearch.cancel();
  }, [query, selectedTags, debouncedHandleSearch]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-3xl font-bold">{t("header")}</h1>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex gap-4">
          <Input
            className="max-w-64 min-w-36"
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Tags tags={selectedTags} onChange={setSelectedTags} />
        </div>
        <Button variant="ghost" onClick={handleReset} className="gap-2 text-lg">
          {t("reset")}
          <X />
        </Button>
      </div>
    </div>
  );
}
