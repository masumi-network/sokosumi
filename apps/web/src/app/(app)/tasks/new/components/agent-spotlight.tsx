"use client";

import { ArrowRight, ChevronLeft, ChevronRight, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { CompanyMark } from "@/components/agents/company-mark";
import { TagIcon } from "@/components/agents/tag-icon";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import type { CoworkerOption } from "@/lib/types/coworker";
import { cn } from "@/lib/utils";
import { regionFlag } from "@/lib/utils/region-flag";

export interface AgentSpotlightLabels {
  defaultBadge: string;
  modelLabel: string;
  hostingLabel: string;
  askPrompt: string;
  promptHint: string;
  previous: string;
  next: string;
  searchPlaceholder: string;
  allCompanies: string;
  selectFromFilters?: string;
  noResults: string;
}

interface AgentSpotlightProps {
  options: CoworkerOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  onUsePrompt: (prompt: string) => void;
  onSelectionInViewChange?: (inView: boolean) => void;
  defaultSlug?: string;
  labels: AgentSpotlightLabels;
}

function matchesQuery(option: CoworkerOption, query: string): boolean {
  const haystack = [
    option.name,
    option.company,
    option.caption,
    ...(option.profile?.capabilities ?? []),
    ...(option.profile?.llm ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export function AgentSpotlight({
  options,
  selectedId,
  onSelect,
  onUsePrompt,
  onSelectionInViewChange,
  defaultSlug = "elena",
  labels,
}: AgentSpotlightProps) {
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState<string | null>(null);

  const companies = useMemo(() => {
    const topPriority = new Map<string, number>();
    for (const option of options) {
      if (!option.company) continue;
      topPriority.set(
        option.company,
        Math.max(topPriority.get(option.company) ?? 0, option.priority ?? 0),
      );
    }
    return Array.from(topPriority.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name]) => name);
  }, [options]);

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter((option) => {
      if (company && option.company !== company) return false;
      if (q && !matchesQuery(option, q)) return false;
      return true;
    });
  }, [options, query, company]);

  const groups = useMemo(() => {
    const map = new Map<string, CoworkerOption[]>();
    for (const option of view) {
      const key = option.company ?? "";
      const list = map.get(key);
      if (list) list.push(option);
      else map.set(key, [option]);
    }
    return Array.from(map.entries())
      .map(([groupCompany, members]) => ({
        company: groupCompany,
        members,
        topPriority: Math.max(...members.map((m) => m.priority ?? 0)),
      }))
      .sort((a, b) => {
        if (a.company === "") return 1;
        if (b.company === "") return -1;
        return (
          b.topPriority - a.topPriority || a.company.localeCompare(b.company)
        );
      });
  }, [view]);

  const current = useMemo(
    () => view.find((option) => option.id === selectedId),
    [view, selectedId],
  );

  useLayoutEffect(() => {
    onSelectionInViewChange?.(current !== undefined);
  }, [current, onSelectionInViewChange]);

  const llm = current?.profile?.llm ?? [];
  const hosting = current?.profile?.hosting;
  const examples = current?.profile?.examples ?? [];
  const isDefault = current?.slug === defaultSlug;

  const railRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(
      Math.ceil(el.scrollLeft + el.clientWidth) < el.scrollWidth - 4,
    );
  }, []);

  useEffect(() => {
    updateArrows();
  }, [updateArrows, view]);

  const scrollRail = (direction: number) => {
    const el = railRef.current;
    if (!el) return;
    el.scrollBy({
      left: direction * el.clientWidth * 0.75,
      behavior: "smooth",
    });
  };

  return (
    <div className="space-y-3">
      <div className="relative">
        {current ? (
          <div
            key={current.id}
            className="animate-in fade-in-0 slide-in-from-bottom-1 duration-300 flex w-full flex-col gap-4 sm:h-[280px] sm:flex-row sm:items-stretch sm:gap-7"
          >
            {/* Hero image panel — poster style with name overlay */}
            <div className="bg-muted ring-border/50 relative h-60 w-full shrink-0 overflow-hidden rounded-xl ring-1 sm:h-full sm:w-[44%]">
              {current.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={current.image}
                  alt={current.name}
                  className="absolute inset-0 size-full object-cover"
                />
              ) : (
                <div className="bg-primary/15 text-primary absolute inset-0 flex items-center justify-center text-5xl font-semibold">
                  {current.name.slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent p-5 pt-12">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="text-xl leading-tight font-semibold text-white drop-shadow">
                    {current.name}
                  </h3>
                  {isDefault ? (
                    <span className="rounded-sm bg-white/25 px-1.5 py-0.5 text-xs leading-none font-medium text-white backdrop-blur-sm">
                      {labels.defaultBadge}
                    </span>
                  ) : null}
                </div>
                {current.caption ? (
                  <p className="mt-1 text-sm font-medium text-white/85 drop-shadow">
                    {current.caption}
                  </p>
                ) : null}
              </div>
            </div>

            {/* Details + prompts */}
            <div className="flex min-w-0 flex-1 flex-col justify-center">
              {current.company ? (
                <div className="mb-3 flex h-6 items-center">
                  <CompanyMark company={current.company} />
                </div>
              ) : null}
              {current.description ? (
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {current.description}
                </p>
              ) : null}

              {llm.length > 0 || hosting ? (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {llm.map((model) => (
                    <span
                      key={model}
                      title={`${labels.modelLabel}: ${model}`}
                      className="border-border/60 text-muted-foreground inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium"
                    >
                      <TagIcon name={model} size={14} />
                      {model}
                    </span>
                  ))}
                  {hosting ? (
                    <span
                      title={`${labels.hostingLabel}: ${hosting}`}
                      className="border-border/60 text-muted-foreground inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium"
                    >
                      <span aria-hidden>{regionFlag(hosting)}</span>
                      {hosting}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {examples.length > 0 ? (
                <div className="mt-4">
                  <p className="text-muted-foreground text-xs font-medium">
                    {labels.askPrompt.replace("{name}", current.name)}
                  </p>
                  <div className="mt-2 grid gap-2">
                    {examples.slice(0, 2).map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() => onUsePrompt(example)}
                        className="group border-border/50 hover:border-primary hover:shadow-sm focus-visible:ring-primary/30 flex items-center justify-between gap-2 rounded-lg border px-3.5 py-2 text-left text-sm leading-snug transition-all outline-none focus-visible:ring-2 active:scale-[0.99]"
                      >
                        <span className="text-foreground/90">{example}</span>
                        <ArrowRight className="text-muted-foreground/40 group-hover:text-primary size-4 shrink-0 transition-all group-hover:translate-x-0.5" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : view.length === 0 ? (
          <p className="text-muted-foreground w-full text-center text-sm">
            {labels.noResults}
          </p>
        ) : (
          <p className="text-muted-foreground w-full text-center text-sm">
            {labels.selectFromFilters ?? labels.noResults}
          </p>
        )}
      </div>

      <div className="border-border -mx-6 flex flex-col gap-2 border-t px-6 pt-3 sm:flex-row-reverse sm:items-center sm:gap-3 md:-mx-8 md:px-8">
        <div className="relative w-full shrink-0 sm:w-60">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={labels.searchPlaceholder}
            className="h-9 pl-9"
            aria-label={labels.searchPlaceholder}
          />
        </div>
        {companies.length > 1 ? (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] sm:mx-0 sm:min-w-0 sm:flex-1 sm:px-0 sm:pb-0 [&::-webkit-scrollbar]:hidden">
            <CompanyChip
              label={labels.allCompanies}
              active={company === null}
              onClick={() => setCompany(null)}
            />
            {companies.map((name) => (
              <CompanyChip
                key={name}
                label={name}
                active={company === name}
                onClick={() => setCompany(company === name ? null : name)}
              />
            ))}
          </div>
        ) : null}
      </div>

      {view.length > 0 ? (
        <div className="border-border -mx-6 -mb-3 border-t px-6 md:-mx-8 md:px-8">
          <div className="relative">
            <div
              ref={railRef}
              onScroll={updateArrows}
              className="divide-border flex items-stretch divide-x overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {groups.map((group) => (
                <div
                  key={group.company || "_none"}
                  className="flex min-h-[116px] shrink-0 flex-col gap-2 px-5 py-3.5 first:pl-0 last:pr-0"
                >
                  <span className="text-muted-foreground truncate text-xs font-medium">
                    {group.company || "Other"}
                  </span>
                  <div className="flex gap-2">
                    {group.members.map((option) => (
                      <CoworkerThumb
                        key={option.id}
                        option={option}
                        selected={option.id === selectedId}
                        onSelect={() => onSelect(option.id)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {canScrollLeft ? (
              <button
                type="button"
                onClick={() => scrollRail(-1)}
                aria-label={labels.previous}
                className="bg-background hover:bg-muted absolute top-1/2 -left-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition-colors"
              >
                <ChevronLeft className="size-4" />
              </button>
            ) : null}
            {canScrollRight ? (
              <button
                type="button"
                onClick={() => scrollRail(1)}
                aria-label={labels.next}
                className="bg-background hover:bg-muted absolute top-1/2 -right-1 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition-colors"
              >
                <ChevronRight className="size-4" />
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-muted-foreground py-2 text-center text-sm">
          {labels.noResults}
        </p>
      )}
    </div>
  );
}

function CoworkerThumb({
  option,
  selected,
  onSelect,
}: {
  option: CoworkerOption;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={selected}
      onClick={onSelect}
      title={option.caption ?? option.name}
      className={cn(
        "focus-visible:ring-primary/30 flex w-28 shrink-0 flex-col items-center gap-1.5 rounded-lg border p-2 text-center transition-all outline-none focus-visible:ring-2",
        selected
          ? "border-primary/60 bg-primary/[0.04]"
          : "border-transparent hover:border-primary hover:shadow-sm",
      )}
    >
      <Avatar className="size-9 rounded-lg">
        <AvatarImage src={option.image} alt="" className="object-cover" />
        <AvatarFallback className="rounded-lg text-xs font-medium">
          {option.name.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <span className="text-foreground w-full truncate text-xs font-medium">
        {option.name}
      </span>
      {option.caption ? (
        <span className="text-muted-foreground w-full truncate text-xs leading-none">
          {option.caption}
        </span>
      ) : null}
    </button>
  );
}

function CompanyChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "focus-visible:ring-primary/30 shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
