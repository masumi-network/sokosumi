"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Check,
  ChevronRight,
  Download,
  Loader2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  getSkillDetailAction,
  getSkillsMarketplaceAction,
  installSkillAction,
  removeSkillAction,
  searchSkillsAction,
} from "@/lib/actions/hermes";
import type {
  InstalledSkill,
  PreinstalledSkill,
  SkillCatalogItem,
} from "@/lib/clients/generated/core";

interface SkillsMarketplaceProps {
  /** Onboarding hides the header + search; settings shows the full browser. */
  variant?: "settings" | "onboarding";
  /**
   * Whether the marketplace is currently visible to the user. The wizard
   * pre-warms this component hidden; when it becomes active after a failed
   * catalog load we silently retry once so the user never lands on a dead
   * shelf that errored while they couldn't see it.
   */
  active?: boolean;
  /** Suppress the internal title/subtitle when the host (e.g. SkillsPanel)
   * already renders its own header. Search stays. */
  hideHeader?: boolean;
  hasActiveSubscription?: boolean;
  onRequireSubscription?: () => void;
}

type ConfirmTarget = { item: SkillCatalogItem; risk: string | null };

const DEBOUNCE_MS = 300;
// Keep the default shelf scannable — the catalog has hundreds of skills, so we
// show only the most-installed marketing skills and let search reach the rest.
const MAX_SETTINGS = 30;
const MAX_ONBOARDING = 16;

export default function SkillsMarketplace({
  variant = "settings",
  active = true,
  hideHeader = false,
  hasActiveSubscription = true,
  onRequireSubscription,
}: SkillsMarketplaceProps) {
  const t = useTranslations("App.Hermes.Skills");

  const [marketing, setMarketing] = useState<SkillCatalogItem[]>([]);
  const [installed, setInstalled] = useState<InstalledSkill[]>([]);
  const [preinstalled, setPreinstalled] = useState<PreinstalledSkill[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SkillCatalogItem[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // Bumping this re-runs the catalog load (manual Retry / on-activate retry).
  const [loadNonce, setLoadNonce] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(
    null,
  );

  const preinstalledSlugs = useMemo(
    () => new Set(preinstalled.map((s) => s.slug)),
    [preinstalled],
  );

  // Image-baked skills can also surface in the orchestrator's installed list;
  // show them once, under the read-only "Included" shelf.
  const visibleInstalled = useMemo(
    () => installed.filter((s) => !preinstalledSlugs.has(s.slug)),
    [installed, preinstalledSlugs],
  );

  const installedBySlug = useMemo(() => {
    const map = new Map<string, InstalledSkill>();
    for (const s of installed) map.set(s.slug, s);
    return map;
  }, [installed]);

  useEffect(() => {
    let cancelled = false;
    const max = variant === "onboarding" ? MAX_ONBOARDING : MAX_SETTINGS;
    setLoading(true);
    setLoadError(false);
    void (async () => {
      try {
        // Single server action — Next serializes concurrent actions, so the
        // fetches are bundled into one (they run in parallel inside it).
        const res = await getSkillsMarketplaceAction({});
        if (cancelled) return;
        if (res.ok) {
          setMarketing(res.data.marketing.slice(0, max));
          setInstalled(res.data.installed);
          setPreinstalled(res.data.preinstalled);
        } else {
          // No toast: this component may be mounted hidden (wizard pre-warm),
          // where a toast would surface context-free on an unrelated step.
          // The failure renders inline with a Retry button instead.
          setLoadError(true);
        }
      } catch {
        // Transport-level failure (network blip, rolling deploy) rejects the
        // action promise itself — without this the spinner would hang forever
        // with no Retry.
        if (cancelled) return;
        setLoadError(true);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [variant, loadNonce]);

  // One silent retry each time the marketplace becomes visible after a
  // failed load — covers the pre-warm fetch dying while the machine was
  // still booting. The ref caps it at one auto-attempt per activation so a
  // persistently down orchestrator can't retry-loop; after that the inline
  // Retry button is the recovery path.
  const autoRetriedRef = useRef(false);
  useEffect(() => {
    if (!active) {
      autoRetriedRef.current = false;
      return;
    }
    if (loadError && !loading && !autoRetriedRef.current) {
      autoRetriedRef.current = true;
      setLoadNonce((n) => n + 1);
    }
  }, [active, loadError, loading]);

  // Debounced search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setSearchError(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    setSearchError(null);
    let cancelled = false;
    const id = setTimeout(() => {
      void (async () => {
        const res = await searchSkillsAction({ q, limit: 24 });
        if (cancelled) return;
        if (res.ok) {
          setResults(res.data);
          setSearchError(null);
        } else {
          const message = res.error.message ?? t("emptyCatalog");
          toast.error(message);
          setSearchError(message);
          setResults([]);
        }
        setSearching(false);
      })();
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [query, t]);

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
      if (!hasActiveSubscription) {
        onRequireSubscription?.();
        return;
      }
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
    [hasActiveSubscription, markInstalled, onRequireSubscription, t],
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
      if (!hasActiveSubscription) {
        onRequireSubscription?.();
        return;
      }
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
    [hasActiveSubscription, onRequireSubscription, t],
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="border-border bg-muted/40 flex gap-2 rounded-lg border px-3 py-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-500" />
        <p className="text-muted-foreground text-xs leading-relaxed">
          {t("disclaimer")}
        </p>
      </div>

      {/* Onboarding embeds this under its own step heading; the header + search
          are settings-only. Hosts with their own header (SkillsPanel) keep
          search but suppress the internal title to avoid doubling it. */}
      {variant === "settings" ? (
        <>
          {!hideHeader ? (
            <div>
              <h3 className="text-foreground text-sm font-semibold">
                {t("title")}
              </h3>
              <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                {t("subtitle")}
              </p>
            </div>
          ) : null}

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
          errorLabel={searchError}
          emptyLabel={t("noResults")}
          installedBySlug={installedBySlug}
          preinstalledSlugs={preinstalledSlugs}
          busy={busy}
          onAdd={handleAdd}
          onRemove={handleRemove}
        />
      ) : loadError ? (
        // After the search branch on purpose: a failed catalog load must not
        // swallow live search results (search hits the registry, which can be
        // up while the orchestrator-backed installed/preinstalled reads fail).
        <div className="flex flex-col items-center gap-3 py-6">
          <p className="text-muted-foreground text-sm">{t("emptyCatalog")}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLoadNonce((n) => n + 1)}
          >
            {t("retry")}
          </Button>
        </div>
      ) : (
        <>
          <SkillShelf
            heading={t("marketingHeading")}
            items={marketing}
            emptyLabel={t("emptyCatalog")}
            installedBySlug={installedBySlug}
            preinstalledSlugs={preinstalledSlugs}
            busy={busy}
            onAdd={handleAdd}
            onRemove={handleRemove}
          />
          {visibleInstalled.length > 0 ? (
            <InstalledShelf
              items={visibleInstalled}
              busy={busy}
              onRemove={handleRemove}
            />
          ) : null}
          {preinstalled.length > 0 ? (
            <PreinstalledShelf items={preinstalled} />
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
  errorLabel,
  emptyLabel,
  installedBySlug,
  preinstalledSlugs,
  busy,
  onAdd,
  onRemove,
}: {
  heading: string;
  items: SkillCatalogItem[];
  loading?: boolean;
  errorLabel?: string | null;
  emptyLabel: string;
  installedBySlug: Map<string, InstalledSkill>;
  preinstalledSlugs: Set<string>;
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
      ) : errorLabel ? (
        <p className="text-muted-foreground py-2 text-sm">{errorLabel}</p>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground py-2 text-sm">{emptyLabel}</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <SkillCard
              key={item.skillId}
              item={item}
              installed={installedBySlug.get(item.slug) ?? null}
              preinstalled={preinstalledSlugs.has(item.slug)}
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
  preinstalled,
  busy,
  onAdd,
  onRemove,
}: {
  item: SkillCatalogItem;
  installed: InstalledSkill | null;
  preinstalled: boolean;
  busy: boolean;
  onAdd: () => void;
  onRemove: (skill: InstalledSkill) => void;
}) {
  const t = useTranslations("App.Hermes.Skills");
  const formatter = useFormatter();
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
        {preinstalled ? (
          <Badge variant="secondary" className="shrink-0 gap-1">
            <Check className="size-3" />
            {t("includedBadge")}
          </Badge>
        ) : installed ? (
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
          {formatter.number(item.installs)}
        </div>
      ) : null}
      {installed && !preinstalled ? (
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

function PreinstalledShelf({ items }: { items: PreinstalledSkill[] }) {
  const t = useTranslations("App.Hermes.Skills");
  return (
    <Collapsible className="flex flex-col gap-2">
      <CollapsibleTrigger className="group text-muted-foreground hover:text-foreground flex w-fit items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        {t("includedHeading")} ({items.length})
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="text-muted-foreground mb-2 text-xs leading-relaxed">
          {t("includedHelp")}
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {items.map((skill) => (
            <div
              key={skill.slug}
              className="border-border bg-card/40 flex flex-col gap-1 rounded-lg border p-3"
            >
              <div className="flex items-start gap-2">
                <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
                  {skill.name}
                </span>
                <Badge variant="secondary" className="shrink-0 gap-1">
                  <Check className="size-3" />
                  {t("includedBadge")}
                </Badge>
              </div>
              {skill.description ? (
                <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
                  {skill.description}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
