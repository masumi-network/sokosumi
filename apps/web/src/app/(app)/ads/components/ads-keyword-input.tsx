"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import {
  MARKET_KEYWORD_LIMIT,
  MARKET_KEYWORD_MAX_LENGTH,
} from "@/lib/ads/market";

interface AdsKeywordInputProps
  extends Omit<
    React.ComponentProps<"input">,
    "defaultValue" | "onChange" | "value"
  > {
  value: string[];
  onChange: (value: string[]) => void;
}

/**
 * Keywords as chips: type and press Enter or comma to add one, remove one with
 * its button. Duplicates (ignoring case) and anything past Core's limit are
 * dropped, and a keyword is cut to Core's length (so a pasted list is not). Typed text is kept when focus leaves, so Save never loses it. The
 * rest of the props (id, aria-*) go to the input, for the form field.
 */
export function AdsKeywordInput({
  value,
  onChange,
  ...inputProps
}: AdsKeywordInputProps) {
  const t = useTranslations("App.Ads.market.form");
  const [draft, setDraft] = useState("");
  const full = value.length >= MARKET_KEYWORD_LIMIT;

  function handleAdd(text: string): void {
    const next = [...value];
    for (const part of text.split(",")) {
      const keyword = part.trim().slice(0, MARKET_KEYWORD_MAX_LENGTH);
      const known = next.some(
        (candidate) => candidate.toLowerCase() === keyword.toLowerCase(),
      );
      if (keyword && !known && next.length < MARKET_KEYWORD_LIMIT) {
        next.push(keyword);
      }
    }
    if (next.length !== value.length) onChange(next);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        {...inputProps}
        autoComplete="off"
        disabled={full}
        placeholder={full ? t("keywordsFull") : t("keywordsPlaceholder")}
        value={draft}
        onBlur={() => handleAdd(draft)}
        onChange={(event) => {
          const text = event.target.value;
          if (text.includes(",")) handleAdd(text);
          else setDraft(text);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          handleAdd(draft);
        }}
      />
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((keyword) => (
            <li
              key={keyword}
              className="bg-muted text-foreground inline-flex items-center gap-1 rounded-full py-1 pr-1 pl-3 text-sm"
            >
              {keyword}
              <button
                aria-label={t("removeKeyword", { keyword })}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex size-5 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
                type="button"
                onClick={() =>
                  onChange(value.filter((candidate) => candidate !== keyword))
                }
              >
                <X aria-hidden className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
