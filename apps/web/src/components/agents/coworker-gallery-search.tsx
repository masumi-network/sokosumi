"use client";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { PageSearchHint } from "@/components/page-search-field";
import { usePageSearchShortcut } from "@/hooks/use-page-search-shortcut";

export function CoworkerGallerySearch({
  query,
  setQuery,
  suggestions,
}: {
  query: string;
  setQuery: (value: string) => void;
  suggestions: string[];
}) {
  const t = useTranslations("App.Agents.CoworkerGallerySection");
  const inputRef = useRef<HTMLInputElement>(null);
  usePageSearchShortcut(inputRef, { focusOnMount: true });
  // Rotating placeholder — cycles the base hint + real example searches so the
  // search feels alive and hints at what you can look for. Pauses on focus/typing
  // and honors reduced-motion.
  const rotatingHints = useMemo(() => {
    const out = [t("searchPlaceholder")];
    for (const suggestion of suggestions) {
      if (!out.includes(suggestion)) out.push(suggestion);
    }
    return out;
  }, [suggestions, t]);
  const [hintIdx, setHintIdx] = useState(0);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  useEffect(() => {
    if (rotatingHints.length <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(
      () => setHintIdx((index) => (index + 1) % rotatingHints.length),
      3000,
    );
    return () => window.clearInterval(id);
  }, [rotatingHints.length]);

  return (
    <>
      {/* Brand gradient ring; intensifies on focus. */}
      <div className="from-quaternary to-chart-1-quinary focus-within:from-primary focus-within:to-chart-1 relative w-full max-w-xl rounded-full bg-gradient-to-r p-0.5 transition-[--tw-gradient-from,--tw-gradient-to] duration-300">
        <div className="@container/page-search relative rounded-full">
          <Search
            aria-hidden
            className="text-background-muted pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 transition-colors"
          />
          <input
            ref={inputRef}
            aria-keyshortcuts="Meta+F Control+F"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onBlur={() => setIsSearchFocused(false)}
            placeholder=""
            aria-label={t("searchHint")}
            className="bg-foreground text-background h-14 w-full rounded-full pr-5 pl-13 @min-[14rem]/page-search:pr-16 text-base outline-none md:text-lg"
          />
          {/* Animated rotating placeholder (hidden while typing/focused) */}
          {query === "" && !isSearchFocused ? (
            <div
              aria-hidden
              className="pointer-events-none absolute top-1/2 right-5 left-13 @min-[14rem]/page-search:right-16 -translate-y-1/2 overflow-hidden text-left"
            >
              <span
                key={hintIdx}
                className="text-background-muted animate-in fade-in slide-in-from-bottom-1.5 block truncate text-base duration-500 md:text-lg"
              >
                {rotatingHints[hintIdx % rotatingHints.length]}
              </span>
            </div>
          ) : null}
          <PageSearchHint className="text-background-muted absolute end-4 top-1/2 -translate-y-1/2" />
        </div>
      </div>
    </>
  );
}
