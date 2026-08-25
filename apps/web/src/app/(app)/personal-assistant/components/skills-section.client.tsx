"use client";

import { SOKO_BOT_CAPABILITIES } from "@sokosumi/soko-bot";
import { ExternalLink, Search, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  installSokoBotSkillAction,
  removeSokoBotSkillAction,
  searchSokoBotSkillsAction,
} from "@/lib/actions/soko-bot/action";
import type {
  SokoBotInstalledSkill,
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
  const [source, setSource] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SokoBotSkillSearchResult[]>([]);
  const [isPending, startTransition] = useTransition();

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
    if (!q) return;
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
      <div>
        <p className="text-muted-foreground mb-1.5 text-xs font-medium uppercase tracking-wide">
          {t("builtIn")}
          {version ? (
            <span className="ml-2 normal-case tracking-normal">
              {version.name}
            </span>
          ) : null}
        </p>
        <ul className="space-y-2">
          {(version?.skills ?? []).map((skill) => (
            <li key={skill.id} className="text-sm">
              <p className="font-medium">{skill.name}</p>
              <p className="text-muted-foreground text-xs">
                {skill.description}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="text-muted-foreground mb-1.5 text-xs font-medium uppercase tracking-wide">
          {t("installedTitle")}
        </p>
        {installed.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("installedEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {installed.map((skill) => (
              <li key={skill.id} className="flex items-start gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 font-medium">
                    {skill.name}
                    <a
                      href={skill.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={skill.slug}
                    >
                      <ExternalLink aria-hidden className="size-3" />
                    </a>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {skill.description || skill.slug}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t("remove")}
                  disabled={isPending}
                  onClick={() => remove(skill)}
                >
                  <Trash2 aria-hidden className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
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
            onChange={(event) => setQuery(event.target.value)}
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
        {results.length > 0 ? (
          <ul className="mt-2 divide-y rounded-md border">
            {results.map((result) => (
              <li
                key={result.id}
                className="flex items-center gap-2 px-3 py-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{result.name}</p>
                  <p className="text-muted-foreground truncate text-xs tabular-nums">
                    {result.source} ·{" "}
                    {t("installs", { count: result.installs })}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isPending}
                  onClick={() => install(result.source, result.name)}
                >
                  {t("install")}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
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

      <div>
        <p className="text-muted-foreground mb-1.5 text-xs font-medium uppercase tracking-wide">
          {t("tools")}
        </p>
        <div className="flex flex-wrap gap-1">
          {(version?.capabilities ?? SOKO_BOT_CAPABILITIES).map(
            (capability) => (
              <span
                key={capability}
                className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs"
              >
                {capability.replaceAll("_", " ")}
              </span>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
