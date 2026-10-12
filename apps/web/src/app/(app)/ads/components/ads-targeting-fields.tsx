"use client";

import type { GoogleLocation } from "@sokosumi/core-client";
import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { flushSync } from "react-dom";
import { useFormContext } from "react-hook-form";

import {
  AsyncSearchCombobox,
  buildComboboxLabels,
} from "@/components/admin/async-search-combobox";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { searchAdLocations } from "@/lib/actions/ads/action";
import {
  GOOGLE_SEARCH_LIMITS,
  type GoogleSearchFormValues,
} from "@/lib/ads/google-search";
import {
  GOOGLE_LOCATION_QUERY_MAX_LENGTH,
  type GoogleTarget,
  hasTarget,
  toGoogleTarget,
} from "@/lib/ads/targeting";
import { cn } from "@/lib/utils";

import { AdsChipList } from "./ads-chip-list";

const LIMIT = GOOGLE_SEARCH_LIMITS.targetIds;

interface AdsGoogleTargetingFieldsProps {
  accountId: string;
  projectId: string;
  /** Google's languages to pick from; null when they could not be loaded. */
  languageOptions: GoogleTarget[] | null;
}

/**
 * The Search campaign's locations and languages. Both are chips in the form
 * (`locations`, `languages`); none means all countries or all languages.
 */
export function AdsGoogleTargetingFields({
  accountId,
  projectId,
  languageOptions,
}: AdsGoogleTargetingFieldsProps) {
  return (
    <>
      <LocationsField accountId={accountId} projectId={projectId} />
      <LanguagesField languageOptions={languageOptions} />
    </>
  );
}

/**
 * One chosen list of the form, with the one way to change it. Removing a chip
 * moves focus to the field's picker once React has re-rendered it: at the
 * limit the picker is disabled until the chip is gone, so focus cannot move
 * before then.
 */
function useTargets(name: "locations" | "languages", pickerId: string) {
  const form = useFormContext<GoogleSearchFormValues>();
  const selected = form.watch(name);

  function set(next: GoogleTarget[]): void {
    form.setValue(name, next, { shouldDirty: true });
  }

  function handleRemove(id: string): void {
    flushSync(() => set(selected.filter((chosen) => chosen.id !== id)));
    document.getElementById(pickerId)?.focus();
  }

  return { selected, set, handleRemove, full: selected.length >= LIMIT };
}

function LocationsField({
  accountId,
  projectId,
}: Omit<AdsGoogleTargetingFieldsProps, "languageOptions">) {
  const t = useTranslations("App.Ads.newCampaign.targeting.locations");
  const pickerId = useId();
  const helpId = useId();
  const { selected, set, handleRemove, full } = useTargets(
    "locations",
    pickerId,
  );

  async function search(query: string): Promise<GoogleLocation[]> {
    const result = await searchAdLocations({
      projectId,
      accountId,
      q: query.slice(0, GOOGLE_LOCATION_QUERY_MAX_LENGTH),
    });
    if (!result.ok) throw new Error("Location search failed");
    return result.value.filter(({ id }) => !hasTarget(selected, id));
  }

  function handleAdd(location: GoogleLocation | null): void {
    if (!location || full || hasTarget(selected, location.id)) return;
    set([...selected, toGoogleTarget(location)]);
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={pickerId}>{t("label")}</Label>
      <p className="text-muted-foreground text-sm" id={helpId}>
        {full ? t("full", { max: LIMIT }) : t("help", { max: LIMIT })}
      </p>
      <AsyncSearchCombobox<GoogleLocation>
        aria-describedby={helpId}
        disabled={full}
        getKey={({ id }) => id}
        getTriggerLabel={({ name }) => name}
        id={pickerId}
        labels={buildComboboxLabels(t)}
        renderOption={LocationOption}
        search={search}
        value={null}
        onChange={handleAdd}
      />
      <AdsChipList
        emptyLabel={t("all")}
        items={selected}
        removeLabel={(name) => t("remove", { name })}
        onRemove={handleRemove}
      />
    </div>
  );
}

function LocationOption({ name, canonicalName, targetType }: GoogleLocation) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate">{name}</span>
      <span className="text-muted-foreground truncate text-xs">
        {[canonicalName, targetType].filter(Boolean).join(" · ")}
      </span>
    </span>
  );
}

function LanguagesField({
  languageOptions,
}: Pick<AdsGoogleTargetingFieldsProps, "languageOptions">) {
  const t = useTranslations("App.Ads.newCampaign.targeting.languages");
  const pickerId = useId();
  const helpId = useId();
  const [open, setOpen] = useState(false);
  const { selected, set, handleRemove, full } = useTargets(
    "languages",
    pickerId,
  );

  function handleToggle(language: GoogleTarget): void {
    if (hasTarget(selected, language.id)) {
      set(selected.filter(({ id }) => id !== language.id));
    } else if (!full) {
      set([...selected, language]);
    }
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={pickerId}>{t("label")}</Label>
      <p className="text-muted-foreground text-sm" id={helpId}>
        {t("help")}
      </p>
      {languageOptions ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              aria-describedby={helpId}
              aria-expanded={open}
              className="text-muted-foreground w-full min-w-0 justify-between gap-2 overflow-hidden font-normal"
              id={pickerId}
              role="combobox"
              type="button"
              variant="outline"
            >
              <span className="truncate">{t("placeholder")}</span>
              <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            className="w-(--radix-popover-trigger-width) p-0"
          >
            <Command>
              <CommandInput placeholder={t("search")} />
              <CommandList>
                <CommandEmpty>{t("empty")}</CommandEmpty>
                <CommandGroup>
                  {languageOptions.map((language) => {
                    const chosen = hasTarget(selected, language.id);
                    return (
                      <CommandItem
                        disabled={full && !chosen}
                        key={language.id}
                        value={language.name}
                        onSelect={() => handleToggle(language)}
                      >
                        <Check
                          className={cn("size-4", !chosen && "opacity-0")}
                        />
                        {language.name}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : (
        <p className="text-muted-foreground text-sm">{t("unavailable")}</p>
      )}
      <AdsChipList
        emptyLabel={t("all")}
        items={selected}
        removeLabel={(name) => t("remove", { name })}
        onRemove={handleRemove}
      />
    </div>
  );
}
