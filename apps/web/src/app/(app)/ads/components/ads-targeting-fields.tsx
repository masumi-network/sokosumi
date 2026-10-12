"use client";

import type { GoogleLocation } from "@sokosumi/core-client";
import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { useFormContext } from "react-hook-form";

import {
  AsyncSearchCombobox,
  buildComboboxLabels,
} from "@/components/admin/async-search-combobox";
import { Button } from "@/components/ui/button";
import { ChipRemoveButton } from "@/components/ui/chip-remove-button";
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
} from "@/lib/ads/targeting";
import { cn } from "@/lib/utils";

const LIMIT = GOOGLE_SEARCH_LIMITS.targetIds;

interface AdsGoogleTargetingFieldsProps {
  accountId: string;
  projectId: string;
  /** Google's languages; null when they could not be loaded. */
  languages: GoogleTarget[] | null;
}

/**
 * The Search campaign's locations and languages. Both are chips in the form
 * (`locations`, `languages`); none means all countries or all languages.
 */
export function AdsGoogleTargetingFields({
  accountId,
  projectId,
  languages,
}: AdsGoogleTargetingFieldsProps) {
  return (
    <>
      <LocationsField accountId={accountId} projectId={projectId} />
      <LanguagesField languages={languages} />
    </>
  );
}

interface TargetChipsProps {
  items: GoogleTarget[];
  /** Said when nothing is chosen. */
  none: string;
  removeLabel: (name: string) => string;
  onRemove: (id: string) => void;
}

/** The chosen items, or what "none" means. */
function TargetChips({ items, none, removeLabel, onRemove }: TargetChipsProps) {
  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{none}</p>;
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map(({ id, name, detail }) => (
        <li
          key={id}
          title={detail}
          className="bg-muted text-foreground inline-flex items-center rounded-full pl-3 text-sm"
        >
          {name}
          <ChipRemoveButton
            aria-label={removeLabel(name)}
            onClick={() => onRemove(id)}
          />
        </li>
      ))}
    </ul>
  );
}

/** Moves focus back to a picker once the chip that had it is gone. */
function focusPicker(id: string): void {
  document.getElementById(id)?.focus();
}

function LocationsField({
  accountId,
  projectId,
}: Omit<AdsGoogleTargetingFieldsProps, "languages">) {
  const t = useTranslations("App.Ads.newCampaign.targeting.locations");
  const form = useFormContext<GoogleSearchFormValues>();
  const pickerId = useId();
  const selected = form.watch("locations");
  const full = selected.length >= LIMIT;

  async function search(query: string): Promise<GoogleLocation[]> {
    const result = await searchAdLocations({
      projectId,
      accountId,
      q: query.slice(0, GOOGLE_LOCATION_QUERY_MAX_LENGTH),
    });
    if (!result.ok) throw new Error("Location search failed");
    return result.value.filter(
      ({ id }) => !selected.some((chosen) => chosen.id === id),
    );
  }

  function handleAdd(location: GoogleLocation | null): void {
    if (!location || full || selected.some(({ id }) => id === location.id)) {
      return;
    }
    form.setValue(
      "locations",
      [
        ...selected,
        {
          id: location.id,
          name: location.name,
          detail: location.canonicalName,
        },
      ],
      { shouldDirty: true },
    );
  }

  function handleRemove(id: string): void {
    form.setValue(
      "locations",
      selected.filter((chosen) => chosen.id !== id),
      { shouldDirty: true },
    );
    focusPicker(pickerId);
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={pickerId}>{t("label")}</Label>
      <p className="text-muted-foreground text-sm">
        {full ? t("full", { max: LIMIT }) : t("help", { max: LIMIT })}
      </p>
      <AsyncSearchCombobox<GoogleLocation>
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
      <TargetChips
        items={selected}
        none={t("all")}
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
  languages,
}: Pick<AdsGoogleTargetingFieldsProps, "languages">) {
  const t = useTranslations("App.Ads.newCampaign.targeting.languages");
  const form = useFormContext<GoogleSearchFormValues>();
  const pickerId = useId();
  const [open, setOpen] = useState(false);
  const selected = form.watch("languages");
  const full = selected.length >= LIMIT;

  function handleToggle(language: GoogleTarget): void {
    const chosen = selected.some(({ id }) => id === language.id);
    if (!chosen && full) return;
    form.setValue(
      "languages",
      chosen
        ? selected.filter(({ id }) => id !== language.id)
        : [...selected, language],
      { shouldDirty: true },
    );
  }

  function handleRemove(id: string): void {
    form.setValue(
      "languages",
      selected.filter((chosen) => chosen.id !== id),
      { shouldDirty: true },
    );
    focusPicker(pickerId);
  }

  return (
    <div className="grid gap-2">
      <Label htmlFor={pickerId}>{t("label")}</Label>
      <p className="text-muted-foreground text-sm">{t("help")}</p>
      {languages ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
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
                  {languages.map((language) => {
                    const chosen = selected.some(
                      ({ id }) => id === language.id,
                    );
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
      <TargetChips
        items={selected}
        none={t("all")}
        removeLabel={(name) => t("remove", { name })}
        onRemove={handleRemove}
      />
    </div>
  );
}
