"use client";

import {
  BadgeCheck,
  Check,
  Download,
  Loader2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getCuratedSkillsAction,
  getInstalledSkillsAction,
  getSkillDetailAction,
  getSkillsCatalogAction,
  installSkillAction,
  removeSkillAction,
  searchSkillsAction,
} from "@/lib/actions/hermes";
import type {
  InstalledSkill,
  SkillCatalogItem,
} from "@/lib/clients/generated/core";

interface SkillsMarketplaceProps {
  /** Onboarding shows only the curated shelf; settings shows the full browser. */
  variant?: "settings" | "onboarding";
}

type ConfirmTarget = { item: SkillCatalogItem; risk: string | null };

const DEBOUNCE_MS = 300;

export default function SkillsMarketplace({
  variant = "settings",
}: SkillsMarketplaceProps) {
  const t = useTranslations("App.Hermes.Skills");

  const [curated, setCurated] = useState<SkillCatalogItem[]>([]);
  const [popular, setPopular] = useState<SkillCatalogItem[]>([]);
  const [installed, setInstalled] = useState<InstalledSkill[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillCatalogItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(
    null,
  );

  const installedBySlug = useMemo(() => {
    const map = new Map<string, InstalledSkill>();
    for (const s of installed) map.set(s.slug, s);
    return map;
  }, [installed]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [curatedRes, installedRes, popularRes] = await Promise.all([
        getCuratedSkillsAction({}),
        getInstalledSkillsAction({}),
        variant === "settings"
          ? getSkillsCatalogAction({ view: "trending", perPage: 24 })
          : Promise.resolve(null),
      ]);
      if (cancelled) return;
      if (curatedRes.ok) setCurated(curatedRes.data);
      if (installedRes.ok) setInstalled(installedRes.data);
      if (popularRes?.ok) setPopular(popularRes.data);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [variant]);

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      const res = await searchSkillsAction({ q, limit: 24 });
      setResults(res.ok ? res.data : []);
      setSearching(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [query]);

  const markInstalled = useCallback(
    (item: SkillCatalogItem, status: string) => {
      setInstalled((prev) => [
        ...prev.filter((s) => s.slug !== item.slug),
        {
          skillId: item.skillId,
          source: item.source,
          slug: item.slug,
          name: item.name,
          auditRisk: null,
          status: status === "installing" ? "installing" : "installed",
          installedAt: null,
        },
      ]);
    },
    [],
  );

  const doInstall = useCallback(
    async (item: SkillCatalogItem) => {
      setBusy(item.skillId);
      const res = await installSkillAction({
        source: item.source,
        slug: item.slug,
      });
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error.message ?? t("addFailed"));
        return;
      }
      markInstalled(item, res.data.status);
      if (res.data.status === "installing") {
        toast(t("pendingToast", { name: item.name }));
      } else {
        toast.success(t("addedToast", { name: item.name }));
      }
    },
    [markInstalled, t],
  );

  const handleAdd = useCallback(
    async (item: SkillCatalogItem) => {
      // Curated skills are pre-vetted — silent 1-click.
      if (item.curated) {
        await doInstall(item);
        return;
      }
      // Otherwise resolve the audit before deciding how to gate.
      setBusy(item.skillId);
      const res = await getSkillDetailAction({
        source: item.source,
        slug: item.slug,
      });
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error.message ?? t("addFailed"));
        return;
      }
      const { auditRisk, audits } = res.data;
      const hasFail = audits.some((a) => a.status === "fail");
      if (auditRisk === "HIGH" || auditRisk === "CRITICAL" || hasFail) {
        toast.error(t("blockedHelp"));
        return;
      }
      const hasWarn = audits.some((a) => a.status === "warn");
      if (auditRisk === "MEDIUM" || auditRisk === null || hasWarn) {
        setConfirmTarget({ item, risk: auditRisk });
        return;
      }
      // NONE / LOW → silent install.
      await doInstall(item);
    },
    [doInstall, t],
  );

  const handleRemove = useCallback(
    async (skill: InstalledSkill) => {
      setBusy(skill.skillId);
      const res = await removeSkillAction({ slug: skill.slug });
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error.message ?? t("removeFailed"));
        return;
      }
      setInstalled((prev) => prev.filter((s) => s.slug !== skill.slug));
      toast.success(t("removedToast", { name: skill.name }));
    },
    [t],
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Onboarding embeds this under its own step heading + shows only the
          curated shelf, so the header + search are settings-only. */}
      {variant === "settings" ? (
        <>
          <div>
            <h3 className="text-foreground text-sm font-semibold">
              {t("title")}
            </h3>
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
              {t("subtitle")}
            </p>
          </div>

          <div className="relative">
            <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="pl-9"
            />
          </div>
        </>
      ) : null}

      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
          <Loader2 className="size-4 animate-spin" /> {t("title")}…
        </div>
      ) : results !== null ? (
        <SkillShelf
          heading={t("resultsHeading")}
          items={results}
          loading={searching}
          emptyLabel={t("noResults")}
          installedBySlug={installedBySlug}
          busy={busy}
          onAdd={handleAdd}
          onRemove={handleRemove}
        />
      ) : (
        <>
          {installed.length > 0 ? (
            <InstalledShelf
              items={installed}
              busy={busy}
              onRemove={handleRemove}
            />
          ) : null}
          <SkillShelf
            heading={t("recommendedHeading")}
            items={curated}
            emptyLabel={t("emptyCatalog")}
            installedBySlug={installedBySlug}
            busy={busy}
            onAdd={handleAdd}
            onRemove={handleRemove}
          />
          {variant === "settings" && popular.length > 0 ? (
            <SkillShelf
              heading={t("popularHeading")}
              items={popular}
              emptyLabel={t("emptyCatalog")}
              installedBySlug={installedBySlug}
              busy={busy}
              onAdd={handleAdd}
              onRemove={handleRemove}
            />
          ) : null}
        </>
      )}

      <AlertDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("reviewTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("reviewBody", { risk: confirmTarget?.risk ?? "unaudited" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("reviewCancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const target = confirmTarget;
                setConfirmTarget(null);
                if (target) void doInstall(target.item);
              }}
            >
              {t("reviewConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SkillShelf({
  heading,
  items,
  loading,
  emptyLabel,
  installedBySlug,
  busy,
  onAdd,
  onRemove,
}: {
  heading: string;
  items: SkillCatalogItem[];
  loading?: boolean;
  emptyLabel: string;
  installedBySlug: Map<string, InstalledSkill>;
  busy: string | null;
  onAdd: (item: SkillCatalogItem) => void;
  onRemove: (skill: InstalledSkill) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
        {heading}
      </h4>
      {loading ? (
        <div className="text-muted-foreground flex items-center gap-2 py-3 text-sm">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground py-2 text-sm">{emptyLabel}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <SkillCard
              key={item.skillId}
              item={item}
              installed={installedBySlug.get(item.slug) ?? null}
              busy={busy === item.skillId}
              onAdd={() => onAdd(item)}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function InstalledShelf({
  items,
  busy,
  onRemove,
}: {
  items: InstalledSkill[];
  busy: string | null;
  onRemove: (skill: InstalledSkill) => void;
}) {
  const t = useTranslations("App.Hermes.Skills");
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
        {t("installedHeading")}
      </h4>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {items.map((skill) => (
          <div
            key={skill.skillId}
            className="border-border bg-card/40 flex items-center gap-2 rounded-lg border px-3 py-2"
          >
            <Check className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
              {skill.name}
            </span>
            {skill.status === "installing" ? (
              <Badge variant="secondary" className="shrink-0">
                {t("pendingBadge")}
              </Badge>
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              disabled={busy === skill.skillId}
              onClick={() => onRemove(skill)}
              aria-label={t("removeAction")}
            >
              {busy === skill.skillId ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function SkillCard({
  item,
  installed,
  busy,
  onAdd,
  onRemove,
}: {
  item: SkillCatalogItem;
  installed: InstalledSkill | null;
  busy: boolean;
  onAdd: () => void;
  onRemove: (skill: InstalledSkill) => void;
}) {
  const t = useTranslations("App.Hermes.Skills");
  return (
    <div className="border-border bg-card/40 flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-foreground truncate text-sm font-medium">
              {item.name}
            </span>
            {item.curated ? (
              <BadgeCheck className="text-primary size-3.5 shrink-0" />
            ) : null}
          </div>
          <p className="text-muted-foreground truncate text-xs">
            {t("bySource", { source: item.source })}
          </p>
        </div>
        {installed ? (
          <Badge variant="secondary" className="shrink-0 gap-1">
            <Check className="size-3" />
            {installed.status === "installing"
              ? t("pendingBadge")
              : t("installedBadge")}
          </Badge>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 shrink-0 gap-1"
            disabled={busy}
            onClick={onAdd}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            {t("addAction")}
          </Button>
        )}
      </div>
      {item.description ? (
        <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
          {item.description}
        </p>
      ) : null}
      {item.installs !== null ? (
        <div className="text-tertiary-foreground flex items-center gap-1 text-[11px]">
          <Download className="size-3" />
          {item.installs.toLocaleString()}
        </div>
      ) : null}
      {installed ? (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground -ml-2 h-6 w-fit gap-1 px-2 text-xs"
          disabled={busy}
          onClick={() => onRemove(installed)}
        >
          <Trash2 className="size-3" />
          {t("removeAction")}
        </Button>
      ) : null}
    </div>
  );
}
