"use client";

import { ExternalLink, Plus, Search, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  browseSokoBotSkillsAction,
  installSokoBotSkillAction,
  removeSokoBotSkillAction,
  searchSokoBotSkillsAction,
} from "@/lib/actions/soko-bot/action";
import type {
  SokoBotInstalledSkill,
  SokoBotSkillBrowse,
  SokoBotSkillSearchResult,
  SokoBotVersion,
} from "@/lib/clients/generated/core";

interface Candidate {
  name: string;
  description: string;
}

/**
 * Built-in skills of the active version, skills the owner installed from
 * skills.sh / GitHub (install, pick among candidates, remove, search), and
 * the tools the assistant may use.
 */
export function SkillsSection({
  version,
  initialInstalled,
}: {
  version: SokoBotVersion | null;
  initialInstalled: SokoBotInstalledSkill[];
}) {
  const t = useTranslations("App.SokoBot.Skills");
  const [installed, setInstalled] = useState(initialInstalled);
  const [adding, setAdding] = useState(false);
  const [source, setSource] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SokoBotSkillSearchResult[] | null>(
    null,
  );
  const [browse, setBrowse] = useState<SokoBotSkillBrowse | null>(null);
  const [page, setPage] = useState(0);
  const [isPending, startTransition] = useTransition();
  const installedNames = new Set(installed.map((skill) => skill.name));

  useEffect(() => {
    let cancelled = false;
    void browseSokoBotSkillsAction({ page }).then((result) => {
      if (!cancelled && result.ok) setBrowse(result.value);
    });
    return () => {
      cancelled = true;
    };
  }, [page]);

  function install(sourceToInstall: string, skillName?: string) {
    startTransition(async () => {
      const result = await installSokoBotSkillAction({
        input: { source: sourceToInstall, skillName: skillName ?? null },
      });
      if (!result.ok) {
        toast.error(result.error.message ?? t("installError"));
        return;
      }
      if (result.value.skill) {
        const skill = result.value.skill;
        setInstalled((current) => [
          ...current.filter((s) => s.name !== skill.name),
          skill,
        ]);
        setCandidates([]);
        setSource("");
        toast.success(t("installed", { name: skill.name }));
      } else {
        setSource(sourceToInstall);
        setCandidates(result.value.candidates);
      }
    });
  }

  function remove(skill: SokoBotInstalledSkill) {
    startTransition(async () => {
      const result = await removeSokoBotSkillAction({ skillId: skill.id });
      if (!result.ok) {
        toast.error(result.error.message ?? t("removeError"));
        return;
      }
      setInstalled((current) => current.filter((s) => s.id !== skill.id));
    });
  }

  function search() {
    const q = query.trim();
    if (!q) {
      setResults(null);
      return;
    }
    startTransition(async () => {
      const result = await searchSokoBotSkillsAction({ q });
      if (!result.ok) {
        toast.error(result.error.message ?? t("searchError"));
        return;
      }
      setResults(result.value);
    });
  }

  return (
    <div className="space-y-5">
      <ul className="grid gap-2 sm:grid-cols-2">
        {(version?.skills ?? []).map((skill) => (
          <li
            key={skill.id}
            className="bg-muted/40 flex flex-col gap-1 rounded-lg px-3 py-2.5 text-sm"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{skill.name}</span>
              <span className="text-muted-foreground shrink-0 text-[0.6875rem] tracking-wide uppercase">
                {t("builtIn")}
              </span>
            </span>
            <span className="text-muted-foreground line-clamp-2 text-xs">
              {skill.description}
            </span>
          </li>
        ))}
        {installed.map((skill) => (
          <li
            key={skill.id}
            className="flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-sm"
          >
            <span className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate font-medium">{skill.name}</span>
                <a
                  href={skill.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-muted-foreground hover:text-foreground shrink-0"
                  aria-label={skill.slug}
                >
                  <ExternalLink aria-hidden className="size-3" />
                </a>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="-my-1 -mr-1.5 size-7"
                aria-label={t("remove")}
                disabled={isPending}
                onClick={() => remove(skill)}
              >
                <Trash2 aria-hidden className="size-3.5" />
              </Button>
            </span>
            <span className="text-muted-foreground line-clamp-2 text-xs">
              {skill.description || skill.slug}
            </span>
          </li>
        ))}
      </ul>

      <div>
        <button
          type="button"
          onClick={() => setAdding((value) => !value)}
          aria-expanded={adding}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
        >
          <Plus aria-hidden className="size-3.5" />
          {t("addTitle")}
        </button>
        {adding ? (
          <div>
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (source.trim()) install(source.trim());
              }}
            >
              <Input
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder={t("sourcePlaceholder")}
                aria-label={t("sourceLabel")}
                autoComplete="off"
              />
              <Button
                type="submit"
                size="sm"
                disabled={isPending || !source.trim()}
              >
                {t("install")}
              </Button>
            </form>
            {candidates.length > 0 ? (
              <div className="mt-2 rounded-md border">
                <p className="text-muted-foreground border-b px-3 py-1.5 text-xs">
                  {t("pickOne", { count: candidates.length })}
                </p>
                <ul className="divide-y">
                  {candidates.map((candidate) => (
                    <li
                      key={candidate.name}
                      className="flex items-center gap-2 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{candidate.name}</p>
                        <p className="text-muted-foreground truncate text-xs">
                          {candidate.description}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => install(source, candidate.name)}
                      >
                        {t("install")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                search();
              }}
            >
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  if (!event.target.value.trim()) setResults(null);
                }}
                placeholder={t("searchPlaceholder")}
                aria-label={t("searchLabel")}
                autoComplete="off"
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={isPending || !query.trim()}
              >
                <Search aria-hidden className="size-3.5" />
                {t("search")}
              </Button>
            </form>
            {(() => {
              const rows: {
                id: string;
                name: string;
                source: string;
                meta: string;
              }[] = results
                ? results.map((r) => ({
                    id: r.id,
                    name: r.name,
                    source: r.source,
                    meta: t("installs", { count: r.installs }),
                  }))
                : (browse?.items ?? []).map((r) => ({
                    id: r.id,
                    name: r.name,
                    source: r.source,
                    meta: `#${r.rank}`,
                  }));
              return (
                <div className="mt-2 rounded-md border">
                  <p className="text-muted-foreground flex items-center justify-between border-b px-3 py-1.5 text-xs">
                    <span>
                      {results
                        ? t("searchResults", { count: results.length })
                        : t("popular")}
                    </span>
                    {!results && browse ? (
                      <span className="flex items-center gap-2 tabular-nums">
                        {t("pageOf", {
                          page: page + 1,
                          pages: Math.max(
                            1,
                            Math.ceil(browse.total / browse.pageSize),
                          ),
                        })}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={page === 0}
                          onClick={() => setPage((p) => Math.max(0, p - 1))}
                        >
                          {t("prev")}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={
                            (page + 1) * browse.pageSize >= browse.total
                          }
                          onClick={() => setPage((p) => p + 1)}
                        >
                          {t("next")}
                        </Button>
                      </span>
                    ) : null}
                  </p>
                  <ul className="divide-y">
                    {rows.length === 0 ? (
                      <li className="text-muted-foreground px-3 py-2 text-sm">
                        {results ? t("noResults") : t("loading")}
                      </li>
                    ) : null}
                    {rows.map((row) => (
                      <li
                        key={row.id}
                        className="flex items-center gap-3 px-3 py-2 text-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{row.name}</p>
                          <p className="text-muted-foreground truncate text-xs tabular-nums">
                            {row.source}
                            {row.meta ? ` · ${row.meta}` : ""}
                          </p>
                        </div>
                        <a
                          href={`https://skills.sh/${row.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={row.id}
                        >
                          <ExternalLink aria-hidden className="size-3.5" />
                        </a>
                        <Button
                          type="button"
                          size="sm"
                          variant={
                            installedNames.has(row.name) ? "ghost" : "outline"
                          }
                          disabled={isPending || installedNames.has(row.name)}
                          onClick={() => install(row.source, row.name)}
                        >
                          {installedNames.has(row.name)
                            ? t("installedLabel")
                            : t("install")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}
            <p className="text-muted-foreground mt-2 text-xs">
              {t("hint")}{" "}
              <a
                href="https://skills.sh"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                skills.sh
              </a>
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
