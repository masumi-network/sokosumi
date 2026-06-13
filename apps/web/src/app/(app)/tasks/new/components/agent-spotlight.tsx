"use client";

import { ModelIcon } from "@lobehub/icons";
import { ArrowRight, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import type { CoworkerOption } from "@/lib/types/coworker";
import { cn } from "@/lib/utils";

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
  noResults: string;
}

interface AgentSpotlightProps {
  options: CoworkerOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  onUsePrompt: (prompt: string) => void;
  defaultSlug?: string;
  labels: AgentSpotlightLabels;
}

const REGION_FLAG: Record<string, string> = {
  EU: "🇪🇺",
  US: "🇺🇸",
  UK: "🇬🇧",
  DE: "🇩🇪",
  APAC: "🌏",
  ASIA: "🌏",
};

function regionFlag(hosting: string): string {
  const prefix = hosting.split("·")[0]?.trim().toUpperCase() ?? "";
  return REGION_FLAG[prefix] ?? "🌐";
}

const COMPANY_LOGOS: Record<string, { light: string; dark: string }> = {
  serviceplan: {
    light: "/images/logos/serviceplan-logo.png",
    dark: "/images/logos/serviceplan-logo-white.png",
  },
  sokosumi: {
    light: "/images/logos/sokosumi-logo-black.svg",
    dark: "/images/logos/sokosumi-logo-white.svg",
  },
};

function companyKey(company: string): string {
  return company
    .toLowerCase()
    .replace(/\s+(ag|gmbh|inc|llc)\.?$/, "")
    .trim();
}

function CompanyMark({ company }: { company: string }) {
  const asset = COMPANY_LOGOS[companyKey(company)];
  if (asset) {
    return (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.light}
          alt={company}
          className="h-5 w-auto object-contain dark:hidden"
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.dark}
          alt={company}
          className="hidden h-5 w-auto object-contain dark:block"
        />
      </>
    );
  }
  return (
    <span className="text-foreground text-sm font-semibold">{company}</span>
  );
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
  defaultSlug = "elena",
  labels,
}: AgentSpotlightProps) {
  const [query, setQuery] = useState("");
  const [company, setCompany] = useState<string | null>(null);

  const companies = useMemo(() => {
    const seen = new Set<string>();
    for (const option of options) {
      if (option.company) seen.add(option.company);
    }
    return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [options]);

  const view = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter((option) => {
      if (company && option.company !== company) return false;
      if (q && !matchesQuery(option, q)) return false;
      return true;
    });
  }, [options, query, company]);

  const current = options.find((option) => option.id === selectedId);

  const go = (direction: number) => {
    if (view.length === 0) return;
    const currentInView = view.findIndex((o) => o.id === selectedId);
    const base = currentInView < 0 ? (direction > 0 ? -1 : 0) : currentInView;
    const next = (base + direction + view.length) % view.length;
    onSelect(view[next].id);
  };

  const llm = current?.profile?.llm ?? [];
  const hosting = current?.profile?.hosting;
  const examples = current?.profile?.examples ?? [];
  const isDefault = current?.slug === defaultSlug;

  return (
    <div className="space-y-4">
      <div className="flex items-stretch gap-3">
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label={labels.previous}
          className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-primary/40 hidden size-9 shrink-0 items-center justify-center self-center rounded-full border transition-colors outline-none focus-visible:ring-2 sm:flex"
        >
          <ChevronLeft className="size-4" />
        </button>

        <div className="relative flex h-[360px] flex-1 items-start justify-center overflow-hidden px-5 pt-2 pb-4 sm:px-10">
          <div
            aria-hidden
            className="bg-primary/[0.07] pointer-events-none absolute -top-24 left-1/2 size-64 -translate-x-1/2 rounded-full blur-3xl"
          />
          {current ? (
            <div
              key={current.id}
              className="animate-in fade-in-0 zoom-in-95 relative flex w-full flex-col items-center text-center duration-200"
            >
              <Avatar className="ring-background size-16 rounded-2xl shadow-sm ring-4">
                <AvatarImage
                  src={current.image}
                  alt={current.name}
                  className="object-cover"
                />
                <AvatarFallback className="rounded-2xl text-base font-semibold">
                  {current.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              <div className="mt-3 flex items-center gap-2">
                <h3 className="text-lg leading-none font-semibold tracking-tight">
                  {current.name}
                </h3>
                {isDefault ? (
                  <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[11px] leading-none font-medium">
                    {labels.defaultBadge}
                  </span>
                ) : null}
              </div>

              {current.company ? (
                <div className="mt-2 flex h-5 items-center justify-center">
                  <CompanyMark company={current.company} />
                </div>
              ) : null}

              {current.description ? (
                <p className="text-muted-foreground mt-3 line-clamp-2 max-w-md text-sm leading-relaxed">
                  {current.description}
                </p>
              ) : null}

              {llm.length > 0 || hosting ? (
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  {llm.map((model) => (
                    <span
                      key={model}
                      title={`${labels.modelLabel}: ${model}`}
                      className="bg-muted text-foreground/80 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
                    >
                      <ModelIcon model={model} type="mono" size={14} />
                      {model}
                    </span>
                  ))}
                  {hosting ? (
                    <span
                      title={`${labels.hostingLabel}: ${hosting}`}
                      className="text-muted-foreground inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
                    >
                      <span aria-hidden>{regionFlag(hosting)}</span>
                      {hosting}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {examples.length > 0 ? (
                <div className="mt-5 w-full max-w-lg">
                  <p className="text-foreground/80 text-sm font-medium">
                    {labels.askPrompt.replace("{name}", current.name)}
                  </p>
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                    {examples.map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() => onUsePrompt(example)}
                        className="group hover:border-primary/50 hover:bg-primary/[0.04] focus-visible:ring-primary/40 flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs leading-snug transition-colors outline-none focus-visible:ring-2"
                      >
                        <span className="text-foreground/80">{example}</span>
                        <ArrowRight className="text-muted-foreground group-hover:text-primary size-3.5 shrink-0 transition-colors" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{labels.noResults}</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => go(1)}
          aria-label={labels.next}
          className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-primary/40 hidden size-9 shrink-0 items-center justify-center self-center rounded-full border transition-colors outline-none focus-visible:ring-2 sm:flex"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {companies.length > 1 ? (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
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

      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={labels.searchPlaceholder}
          className="h-9 pl-9"
          aria-label={labels.searchPlaceholder}
        />
      </div>

      {view.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {view.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-current={option.id === selectedId}
              onClick={() => onSelect(option.id)}
              className={cn(
                "focus-visible:ring-primary/40 flex w-24 shrink-0 flex-col items-center gap-1.5 rounded-xl border p-2 text-center transition-colors outline-none focus-visible:ring-2",
                option.id === selectedId
                  ? "border-primary bg-primary/[0.04]"
                  : "border-border hover:bg-muted/50",
              )}
            >
              <Avatar className="size-9 rounded-lg">
                <AvatarImage
                  src={option.image}
                  alt=""
                  className="object-cover"
                />
                <AvatarFallback className="rounded-lg text-[11px] font-medium">
                  {option.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-foreground w-full truncate text-xs font-medium">
                {option.name}
              </span>
              {option.company ? (
                <span className="text-muted-foreground w-full truncate text-[11px] leading-none">
                  {option.company}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground py-2 text-center text-sm">
          {labels.noResults}
        </p>
      )}
    </div>
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
        "focus-visible:ring-primary/40 shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
      )}
    >
      {label}
    </button>
  );
}
