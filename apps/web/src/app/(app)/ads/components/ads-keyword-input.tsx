"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  MARKET_KEYWORD_LIMIT,
  MARKET_KEYWORD_MAX_LENGTH,
} from "@/lib/ads/market";

interface AdsKeywordInputProps
  extends Omit<
    React.ComponentProps<"input">,
    "defaultValue" | "onChange" | "ref" | "value"
  > {
  value: string[];
  onChange: (value: string[]) => void;
}

/**
 * Keywords as chips. Type and press Enter or comma to add one; remove one with
 * its button, after which focus returns to the field. A keyword already there
 * (ignoring case) or past Core's limit is dropped, and one is cut to Core's
 * length. Text still in the field when focus leaves is added, so Save never
 * loses it. At the limit the field stays focusable but read-only, and says so.
 * Other props (id, aria-*) go to the field, for the form around it.
 */
export function AdsKeywordInput({
  value,
  onChange,
  ...inputProps
}: AdsKeywordInputProps) {
  const t = useTranslations("App.Ads.market.form");
  const inputRef = useRef<HTMLInputElement>(null);
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

  function handleRemove(keyword: string): void {
    onChange(value.filter((candidate) => candidate !== keyword));
    inputRef.current?.focus();
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        {...inputProps}
        ref={inputRef}
        autoComplete="off"
        placeholder={t("keywordsPlaceholder")}
        readOnly={full}
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
      {full ? (
        <p className="text-muted-foreground text-xs" role="status">
          {t("keywordsFull")}
        </p>
      ) : null}
      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {value.map((keyword) => (
            <li
              key={keyword}
              className="bg-muted text-foreground inline-flex items-center rounded-full pl-3 text-sm"
            >
              {keyword}
              <button
                aria-label={t("removeKeyword", { keyword })}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring flex size-8 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none sm:size-7"
                type="button"
                onClick={() => handleRemove(keyword)}
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
