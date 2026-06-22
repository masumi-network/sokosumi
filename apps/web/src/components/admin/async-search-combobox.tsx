"use client";

import { Check, ChevronsUpDown, X } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
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
import { getEnvPublicConfig } from "@/config/env.public";
import { cn } from "@/lib/utils";

export interface AsyncSearchComboboxLabels {
  /** Shown on the trigger when nothing is selected. */
  placeholder: string;
  /** Placeholder text inside the search input. */
  searchPlaceholder: string;
  /** Shown while a query is debouncing or a request is in flight. */
  loading: string;
  /** Shown when a non-empty query returns no matches. */
  empty: string;
  /** Shown when the search request fails. */
  error: string;
  /** Shown before the admin has typed anything (we never pre-load options). */
  idle: string;
  /** Accessible label for the inline clear control on the trigger. */
  clear?: string;
}

/**
 * Translator for a combobox-labels namespace (e.g. `Components.OrganizationCombobox`,
 * `Components.UserCombobox`) that exposes the standard label keys.
 */
type ComboboxLabelTranslator = (
  key: "placeholder" | "search" | "empty" | "loading" | "error" | "idle",
) => string;

/**
 * Builds the {@link AsyncSearchComboboxLabels} from a namespace translator,
 * collapsing the repeated `t(...)` wiring at each call site. Pass `overrides`
 * to customise the trigger placeholder or clear label (e.g. a filter that shows
 * "All organizations").
 */
export function buildComboboxLabels(
  t: ComboboxLabelTranslator,
  overrides?: Partial<AsyncSearchComboboxLabels>,
): AsyncSearchComboboxLabels {
  return {
    placeholder: t("placeholder"),
    searchPlaceholder: t("search"),
    empty: t("empty"),
    loading: t("loading"),
    error: t("error"),
    idle: t("idle"),
    ...overrides,
  };
}

interface AsyncSearchComboboxProps<T> {
  /** The currently selected option (the caller owns it so the trigger label
   * renders without a fetch-by-id round trip), or null when none is selected. */
  value: T | null;
  onChange: (option: T | null) => void;
  /** Async search invoked after the debounce. Must return matching options. */
  search: (query: string) => Promise<T[]>;
  getKey: (option: T) => string;
  renderOption: (option: T) => ReactNode;
  getTriggerLabel: (option: T) => string;
  labels: AsyncSearchComboboxLabels;
  /** When true, shows an inline clear control on the trigger when a value is set. */
  allowClear?: boolean;
  disabled?: boolean;
  id?: string;
}

export function AsyncSearchCombobox<T>({
  value,
  onChange,
  search,
  getKey,
  renderOption,
  getTriggerLabel,
  labels,
  allowClear,
  disabled,
  id,
}: AsyncSearchComboboxProps<T>) {
  const debounceTime =
    getEnvPublicConfig().NEXT_PUBLIC_KEYBOARD_INPUT_DEBOUNCE_TIME;

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  // Monotonic id so out-of-order responses from a slow earlier query are
  // discarded in favour of the latest one.
  const requestIdRef = useRef(0);

  // Debounce: mirror the input into `debouncedQuery` after the configured delay.
  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, debounceTime);
    return () => window.clearTimeout(timeoutId);
  }, [query, debounceTime]);

  const runSearch = useEffectEvent(async (nextQuery: string) => {
    const requestId = ++requestIdRef.current;
    if (!nextQuery) {
      setResults([]);
      setIsLoading(false);
      setHasError(false);
      return;
    }
    setIsLoading(true);
    setHasError(false);
    try {
      const options = await search(nextQuery);
      if (requestId !== requestIdRef.current) {
        return;
      }
      setResults(options);
    } catch {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setHasError(true);
      setResults([]);
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  });

  useEffect(() => {
    if (!open) {
      return;
    }
    void runSearch(debouncedQuery);
  }, [debouncedQuery, open]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset transient search state and cancel any in-flight response.
      requestIdRef.current++;
      setQuery("");
      setDebouncedQuery("");
      setResults([]);
      setIsLoading(false);
      setHasError(false);
    }
  }

  const selectedKey = value ? getKey(value) : null;
  // A query is "settled" only once the debounced value caught up with the input.
  const isPending = query.trim() !== debouncedQuery;
  const showLoading = query.trim().length > 0 && (isLoading || isPending);
  const showIdle = query.trim().length === 0;
  const showEmpty =
    !showLoading && !hasError && !showIdle && results.length === 0;
  const showInlineClear = Boolean(allowClear && value);

  function handleClearSelection(event: MouseEvent | KeyboardEvent) {
    event.preventDefault();
    event.stopPropagation();
    onChange(null);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full min-w-0 justify-between gap-2 overflow-hidden font-normal"
        >
          <span
            className={cn(
              "min-w-0 truncate",
              !value && "text-muted-foreground",
            )}
            title={value ? getTriggerLabel(value) : undefined}
          >
            {value ? getTriggerLabel(value) : labels.placeholder}
          </span>
          {showInlineClear ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={labels.clear ?? "Clear selection"}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring shrink-0 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={handleClearSelection}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  handleClearSelection(event);
                }
              }}
            >
              <X className="size-4" />
            </span>
          ) : (
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0"
        align="start"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={labels.searchPlaceholder}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            {showLoading ? (
              <div className="text-muted-foreground py-6 text-center text-sm">
                {labels.loading}
              </div>
            ) : null}
            {!showLoading && hasError ? (
              <div className="text-destructive py-6 text-center text-sm">
                {labels.error}
              </div>
            ) : null}
            {!showLoading && !hasError && showIdle ? (
              <div className="text-muted-foreground py-6 text-center text-sm">
                {labels.idle}
              </div>
            ) : null}
            {showEmpty ? (
              <div className="text-muted-foreground py-6 text-center text-sm">
                {labels.empty}
              </div>
            ) : null}
            {!showLoading && !hasError && results.length > 0 ? (
              <CommandGroup>
                {results.map((option) => {
                  const key = getKey(option);
                  return (
                    <CommandItem
                      key={key}
                      value={key}
                      onSelect={() => {
                        onChange(option);
                        handleOpenChange(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "size-4",
                          selectedKey === key ? "opacity-100" : "opacity-0",
                        )}
                      />
                      {renderOption(option)}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
