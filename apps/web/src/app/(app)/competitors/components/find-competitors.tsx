"use client";

import type { ProjectCompetitorSuggestions } from "@sokosumi/core-client";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addSuggestedCompetitors,
  findCompetitors,
} from "@/lib/actions/competitors/action";

type Suggestion = ProjectCompetitorSuggestions["suggestions"][number];

function host(url: string): string {
  return URL.parse(url)?.hostname.replace(/^www\./, "") ?? url;
}

/**
 * Finds competitors from the Project's website and lets the member pick
 * which to watch. The search starts with the click; nothing is added until
 * the member ticks a company and presses Add.
 */
export function FindCompetitors({
  projectId,
  projectName,
  room,
  variant,
}: {
  projectId: string;
  projectName: string;
  /** How many more competitors the Project can watch. */
  room: number;
  variant?: "primary";
}) {
  const t = useTranslations("App.Competitors.find");
  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearching] = useTransition();
  const [adding, startAdding] = useTransition();

  function search() {
    setOpen(true);
    setSuggestions(null);
    setPicked([]);
    setError(null);
    startSearching(async () => {
      const result = await findCompetitors({ projectId });
      if (result.ok) setSuggestions(result.value);
      else setError(result.error.message ?? t("failed"));
    });
  }

  function add() {
    const competitors = (suggestions ?? [])
      .filter((suggestion) => picked.includes(suggestion.websiteUrl))
      .map(({ name, websiteUrl }) => ({ name, websiteUrl }));
    setError(null);
    startAdding(async () => {
      const result = await addSuggestedCompetitors({ projectId, competitors });
      if (result.ok) setOpen(false);
      else setError(result.error.message ?? t("failed"));
    });
  }

  function toggle(url: string, on: boolean) {
    setPicked((current) =>
      on ? [...current, url] : current.filter((other) => other !== url),
    );
  }

  return (
    <>
      <Button onClick={search} size="sm" variant={variant}>
        {t("open")}
      </Button>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>
              {t("description", { project: projectName })}
            </DialogDescription>
          </DialogHeader>
          {searching ? (
            <p className="text-muted-foreground text-sm" role="status">
              {t("searching", { project: projectName })}
            </p>
          ) : null}
          {suggestions?.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("none")}</p>
          ) : null}
          {suggestions && suggestions.length > 0 ? (
            <ul className="-mx-2 flex max-h-96 flex-col overflow-y-auto">
              {suggestions.map((suggestion) => {
                const id = `suggestion-${suggestion.websiteUrl}`;
                const on = picked.includes(suggestion.websiteUrl);
                return (
                  <li key={suggestion.websiteUrl}>
                    <label
                      className="hover:bg-quinary flex cursor-pointer items-start gap-3 rounded-md px-2 py-2"
                      htmlFor={id}
                    >
                      <Checkbox
                        checked={on}
                        className="mt-0.5"
                        disabled={adding || (!on && picked.length >= room)}
                        id={id}
                        onCheckedChange={(checked) =>
                          toggle(suggestion.websiteUrl, checked === true)
                        }
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-sm">
                          <span className="font-medium">{suggestion.name}</span>{" "}
                          <span className="text-muted-foreground">
                            {host(suggestion.websiteUrl)}
                          </span>
                        </span>
                        <span className="text-muted-foreground text-sm">
                          {suggestion.why}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {error ? (
            <p className="text-sm" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter className="sm:items-center">
            <p className="text-muted-foreground text-xs sm:mr-auto">
              {suggestions && suggestions.length > 0
                ? t("room", { count: room - picked.length })
                : t("free")}
            </p>
            {error && !suggestions ? (
              <Button disabled={searching} onClick={search} type="button">
                {t("retry")}
              </Button>
            ) : (
              <Button
                disabled={adding}
                onClick={() => setOpen(false)}
                type="button"
              >
                {t("cancel")}
              </Button>
            )}
            <Button
              disabled={picked.length === 0}
              loading={adding}
              onClick={add}
              type="button"
              variant="primary"
            >
              {t("add", { count: picked.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
