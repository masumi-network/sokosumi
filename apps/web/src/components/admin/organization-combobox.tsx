"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AdminOrganizationOption } from "@/lib/services/admin-organization.service";
import { cn } from "@/lib/utils";

interface OrganizationComboboxProps {
  organizations: AdminOrganizationOption[];
  /** Selected organization id, or "" when none is selected. */
  value: string;
  onChange: (organization: AdminOrganizationOption | null) => void;
  disabled?: boolean;
  id?: string;
  /** Overrides the trigger text shown when no organization is selected. */
  placeholder?: string;
  /** When true, renders an option that clears the current selection. */
  allowClear?: boolean;
}

export function OrganizationCombobox({
  organizations,
  value,
  onChange,
  disabled,
  id,
  placeholder,
  allowClear,
}: OrganizationComboboxProps) {
  const t = useTranslations("Components.OrganizationCombobox");
  const [open, setOpen] = useState(false);

  const emptyLabel = placeholder ?? t("placeholder");

  const selected = useMemo(
    () => organizations.find((org) => org.id === value) ?? null,
    [organizations, value],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn(!selected && "text-muted-foreground")}>
            {selected ? selected.name : emptyLabel}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0"
        align="start"
      >
        <Command
          filter={(itemValue, search) =>
            itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <CommandInput placeholder={t("search")} />
          <CommandList>
            <CommandEmpty>{t("empty")}</CommandEmpty>
            {allowClear ? (
              <CommandGroup>
                <CommandItem
                  value={emptyLabel}
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "size-4",
                      value === "" ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="text-muted-foreground">{emptyLabel}</span>
                </CommandItem>
              </CommandGroup>
            ) : null}
            <CommandGroup>
              {organizations.map((org) => (
                <CommandItem
                  key={org.id}
                  value={`${org.name} ${org.slug}`}
                  onSelect={() => {
                    onChange(org);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "size-4",
                      value === org.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="flex flex-col">
                    <span>{org.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {org.slug}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
