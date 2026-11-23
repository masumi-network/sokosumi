"use client";

import { SearchIcon } from "lucide-react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { activeSearchField } from "@/hooks/effects/use-page-search-shortcut";

/**
 * Find on this page, as an icon in a project's title row below md: the page's
 * field stays out of sight there until this focuses it. Escape on an empty
 * field brings focus back here.
 */
export function ProjectFindButton({ label }: { label: string }) {
  const ref = useRef<HTMLButtonElement>(null);

  function open() {
    const input = activeSearchField();
    if (!input) return;
    // Inside the tap, so a phone opens its keyboard.
    input.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || input?.value) return;
      event.preventDefault();
      ref.current?.focus();
    }
    input.addEventListener("keydown", onKeyDown);
    input.addEventListener(
      "blur",
      () => input.removeEventListener("keydown", onKeyDown),
      { once: true },
    );
  }

  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      onClick={open}
      className="text-muted-foreground hit-area size-8 md:hidden"
    >
      <SearchIcon className="size-4" aria-hidden />
    </Button>
  );
}
