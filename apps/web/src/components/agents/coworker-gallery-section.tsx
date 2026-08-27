"use client";

import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Search,
} from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import { StartChatButton } from "@/app/chat/components/landing/start-chat-button.client";
import { OpenCoworkerRoomProvider } from "@/app/chat/components/landing/use-open-coworker-room";
import { coworkerCanChat } from "@/app/chat/utils/coworker-utils";
import { useCreateTaskModal } from "@/app/tasks/components/create-task-modal";
import { COWORKER_FALLBACK_IMAGES } from "@/app/tasks/utils/coworker-fallback-images";
import {
  OfferCard,
  OfferDetailDialog,
  type OfferDetailItem,
  type OutputKind,
} from "@/components/agents/offer-card";
import { TagIcon } from "@/components/agents/tag-icon";
import { VendorMark } from "@/components/agents/vendor-mark";
import { Button } from "@/components/ui/button";
import { canUseNextImageSrc } from "@/config/next-image";
import { useHasAssignedOrganizationSeat } from "@/contexts/organization-seat-context";
import useGalleryFilter from "@/hooks/use-gallery-filter";
import type { Coworker } from "@/lib/clients/generated/core";
import type { CoworkerOffer } from "@/lib/types/coworker";
import { cn } from "@/lib/utils";
import { regionFlag } from "@/lib/utils/region-flag";

interface CoworkerGallerySectionProps {
  coworkers: Coworker[];
}

interface OfferItem {
  offer: CoworkerOffer;
  coworker: Coworker;
}

const FOCUS_RING =
  "focus-visible:ring-primary/40 outline-none focus-visible:ring-2";

// Initial caps so the section stays tight as the team grows; both expand on
// demand and are bypassed entirely while searching.
const VENDOR_CAP = 2;

interface VendorInfo {
  description?: string;
  website?: string;
  legal?: string;
}
const VENDOR_DETAILS: Record<string, VendorInfo> = {
  serviceplan: {
    description:
      "Coworkers from Serviceplan — strategy, planning, and creative leadership for your projects.",
    website: "https://www.serviceplan.com",
    legal: "https://www.serviceplan.com/en/imprint.html",
  },
  masumi: {
    description:
      "Coworkers from Masumi — agents and automation built on the Masumi network.",
  },
  "utxo-ag": {
    description:
      "Coworkers from utxo AG — engineering, prototyping, and content, ready to build.",
  },
};
function vendorDetails(slug: string): VendorInfo {
  return VENDOR_DETAILS[slug] ?? {};
}

function coworkerImage(coworker: Coworker): string {
  return (
    coworker.image ||
    COWORKER_FALLBACK_IMAGES[coworker.slug] ||
    "/images/logos/sokosumi-logo-white.svg"
  );
}

function modelList(coworker: Coworker): string[] {
  return coworker.metadata?.profile?.llm ?? [];
}

function hostingOf(coworker: Coworker): string | undefined {
  return coworker.metadata?.profile?.hosting ?? undefined;
}

/** Square source images → square/round container with object-cover never crops. */
function CoworkerAvatar({
  coworker,
  className,
  sizes,
}: {
  coworker: Coworker;
  className?: string;
  sizes?: string;
}) {
  const image = coworkerImage(coworker);
  return (
    <div
      className={cn(
        "bg-muted ring-border relative shrink-0 overflow-hidden ring-1",
        className,
      )}
    >
      {canUseNextImageSrc(image) ? (
        <Image
          src={image}
          alt={coworker.name}
          fill
          className="object-cover"
          sizes={sizes ?? "96px"}
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- next/image rejects unconfigured remote hosts
        <img
          src={image}
          alt={coworker.name}
          className="absolute inset-0 size-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}
    </div>
  );
}

/** Model + region "spec" tags. */
function MetaTags({
  coworker,
  maxModels,
  className,
}: {
  coworker: Coworker;
  maxModels?: number;
  className?: string;
}) {
  const models = modelList(coworker);
  const hosting = hostingOf(coworker);
  const shownModels = maxModels ? models.slice(0, maxModels) : models;
  const hiddenModels = models.length - shownModels.length;
  if (!shownModels.length && !hosting) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {shownModels.map((model) => (
        <span
          key={model}
          className="bg-muted/70 text-muted-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
        >
          <TagIcon name={model} size={12} />
          {model}
        </span>
      ))}
      {hiddenModels > 0 ? (
        <span className="text-muted-foreground text-xs font-medium">
          +{hiddenModels}
        </span>
      ) : null}
      {hosting ? (
        <span className="bg-muted/70 text-muted-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium">
          <span aria-hidden>{regionFlag(hosting)}</span>
          {hosting}
        </span>
      ) : null}
    </div>
  );
}

/** Offers shown per coworker before the "show all" toggle reveals the rest. */
const OFFER_PREVIEW_COUNT = 3;

interface DashboardLabels {
  count: string;
  website: string;
  legal: string;
  other: string;
  offersTitle: string;
  startForCoworker: (name: string) => string;
  noOffers: string;
  showAllOffers: (count: number) => string;
  showLess: string;
}

/** A company "dashboard": pick a coworker, see their ready-to-run offers. Outlined +
 * divided on purpose — a mechanical panel that gives the section a clear hierarchy. */
function VendorDashboard({
  vendor,
  members,
  offers,
  labels,
  typeLabel,
  onOpenOffer,
  onStartTask,
  isFirst,
}: {
  vendor: Coworker["vendor"];
  members: Coworker[];
  offers: OfferItem[];
  labels: DashboardLabels;
  typeLabel: (type: OutputKind) => string;
  onOpenOffer: (item: OfferItem) => void;
  onStartTask: (assigneeId: string, prompt?: string) => void;
  isFirst: boolean;
}) {
  const hasAssignedSeat = useHasAssignedOrganizationSeat();
  const tSeat = useTranslations("App.Channels");
  const [activeId, setActiveId] = useState(members[0]?.id);
  const [showAllOffers, setShowAllOffers] = useState(false);
  const active = members.find((member) => member.id === activeId) ?? members[0];
  if (!active) return null;
  const allActiveOffers = offers.filter(
    (item) => item.coworker.id === active.id,
  );
  const activeOffers = showAllOffers
    ? allActiveOffers
    : allActiveOffers.slice(0, OFFER_PREVIEW_COUNT);
  const hasMoreOffers = allActiveOffers.length > OFFER_PREVIEW_COUNT;
  const info = vendorDetails(vendor.slug);

  return (
    <div className={cn(isFirst ? "" : "pt-8 md:pt-10")}>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex h-6 items-center gap-3">
          <VendorMark
            vendor={vendor}
            className="h-5"
            textClassName="text-foreground text-base leading-none font-semibold"
          />
          <span className="text-muted-foreground text-sm leading-none">
            {labels.count}
          </span>
        </div>
        {info.website || info.legal ? (
          <div className="flex items-center gap-4">
            {info.website ? (
              <a
                href={info.website}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-md text-sm font-medium",
                  FOCUS_RING,
                )}
              >
                {labels.website}
                <ExternalLink aria-hidden className="size-3.5" />
              </a>
            ) : null}
            {info.legal ? (
              <a
                href={info.legal}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-md text-sm font-medium",
                  FOCUS_RING,
                )}
              >
                {labels.legal}
                <ExternalLink aria-hidden className="size-3.5" />
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Header rule — flush above the grid */}
      <div aria-hidden className="border-border/60 -mx-6 border-t" />

      {/* Master–detail. The detail column's left border is the divider; both
          columns pad to the bottom so it reaches the closing rule below. */}
      <div className="grid gap-6 md:grid-cols-[13.5rem_1fr] md:gap-0">
        {/* Rail — coworker selector (horizontal on mobile, vertical list on desktop) */}
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pt-6 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pt-6 md:pr-6 md:pb-10">
          {members.map((member) => {
            const isActive = member.id === active.id;
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => {
                  setActiveId(member.id);
                  setShowAllOffers(false);
                }}
                aria-pressed={isActive}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors md:w-full",
                  FOCUS_RING,
                  isActive ? "bg-muted" : "hover:bg-muted/50",
                )}
              >
                <CoworkerAvatar
                  coworker={member}
                  className="size-8 rounded-full"
                  sizes="32px"
                />
                <div className="min-w-0">
                  <p className="text-foreground truncate text-sm font-medium">
                    {member.name}
                  </p>
                  {member.caption ? (
                    <p className="text-muted-foreground truncate text-xs">
                      {member.caption}
                    </p>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>

        {/* Detail — the selected coworker (focus) + their offers. Its left
              border IS the divider: a border always spans the element's full
              height, and this column is the tall, content-filled one. */}
        <div className="space-y-5 md:border-border/60 md:border-l md:pt-6 md:pb-10 md:pl-9">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <CoworkerAvatar
                coworker={active}
                className="size-14 rounded-full sm:size-16"
                sizes="64px"
              />
              <div className="min-w-0">
                <h3 className="text-foreground text-lg font-medium">
                  {active.name}
                </h3>
                {active.caption ? (
                  <p className="text-muted-foreground text-sm">
                    {active.caption}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
              {hasAssignedSeat ? (
                <>
                  {coworkerCanChat(active) ? (
                    <StartChatButton
                      coworkerId={active.id}
                      coworkerName={active.name}
                      variant="outline"
                      className="w-full sm:w-auto"
                    />
                  ) : null}
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    className="w-full sm:w-auto"
                    onClick={() => onStartTask(active.id)}
                  >
                    {labels.startForCoworker(active.name)}
                    <ArrowRight aria-hidden className="size-4" />
                  </Button>
                </>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {tSeat("Seat.coworkerDirectDisabled")}
                </p>
              )}
            </div>
          </div>

          {active.description ? (
            <p className="text-foreground/80 text-sm leading-relaxed text-pretty">
              {active.description}
            </p>
          ) : null}

          <MetaTags coworker={active} />

          <div className="space-y-3 pt-2">
            <p className="text-muted-foreground text-xs font-medium">
              {labels.offersTitle}
            </p>
            {activeOffers.length > 0 ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {activeOffers.map((item) => (
                    <OfferCard
                      key={`${item.coworker.id}-${item.offer.title}`}
                      offer={item.offer}
                      typeLabel={typeLabel}
                      onClick={() => onOpenOffer(item)}
                      coworkerName={item.coworker.name}
                      coworkerAvatar={
                        <CoworkerAvatar
                          coworker={item.coworker}
                          className="size-6 rounded-full"
                          sizes="24px"
                        />
                      }
                    />
                  ))}
                </div>
                {hasMoreOffers ? (
                  <button
                    type="button"
                    onClick={() => setShowAllOffers((value) => !value)}
                    className={cn(
                      "text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-md text-sm font-medium",
                      FOCUS_RING,
                    )}
                  >
                    {showAllOffers
                      ? labels.showLess
                      : labels.showAllOffers(allActiveOffers.length)}
                    <ChevronDown
                      aria-hidden
                      className={cn(
                        "size-4 transition-transform",
                        showAllOffers && "rotate-180",
                      )}
                    />
                  </button>
                ) : null}
              </>
            ) : (
              <p className="text-muted-foreground text-sm">{labels.noOffers}</p>
            )}
          </div>
        </div>
      </div>
      {/* Closing rule — flush below the grid; connects the vertical divider
            and separates this company from the next. */}
      <div aria-hidden className="border-border/60 -mx-6 border-t" />
    </div>
  );
}

function CoworkerGallerySection({ coworkers }: CoworkerGallerySectionProps) {
  return (
    <OpenCoworkerRoomProvider>
      <CoworkerGallerySectionInner coworkers={coworkers} />
    </OpenCoworkerRoomProvider>
  );
}

function CoworkerGallerySectionInner({
  coworkers,
}: CoworkerGallerySectionProps) {
  const t = useTranslations("App.Agents.CoworkerGallerySection");
  const hasAssignedSeat = useHasAssignedOrganizationSeat();
  const getTypeLabel = (type: OutputKind) => t(`outputTypes.${type}`);
  // Gallery search query (URL-backed) filters coworker offers below.
  const { query, setQuery } = useGalleryFilter();
  const { handleOpenWith } = useCreateTaskModal();
  const [selected, setSelected] = useState<OfferItem | null>(null);
  const [showAllCompanies, setShowAllCompanies] = useState(false);

  const sortedCoworkers = useMemo(
    () =>
      [...coworkers].sort(
        (a, b) =>
          (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name),
      ),
    [coworkers],
  );

  // One offer title per top coworker — clicking a suggestion pre-fills search.
  const suggestions = useMemo(() => {
    const out: string[] = [];
    for (const coworker of sortedCoworkers) {
      const first = coworker.metadata?.offers?.[0]?.title;
      if (first && !out.includes(first)) out.push(first);
      if (out.length >= 5) break;
    }
    return out;
  }, [sortedCoworkers]);

  // Rotating placeholder — cycles the base hint + real example searches so the
  // search feels alive and hints at what you can look for. Pauses on focus/typing
  // and honors reduced-motion.
  const rotatingHints = useMemo(() => {
    const out = [t("searchPlaceholder")];
    for (const suggestion of suggestions) {
      if (!out.includes(suggestion)) out.push(suggestion);
    }
    return out;
  }, [suggestions, t]);
  const [hintIdx, setHintIdx] = useState(0);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  useEffect(() => {
    if (rotatingHints.length <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(
      () => setHintIdx((index) => (index + 1) % rotatingHints.length),
      3000,
    );
    return () => window.clearInterval(id);
  }, [rotatingHints.length]);

  // Social proof: a cluster of real coworker faces.
  const socialAvatars = useMemo(
    () => sortedCoworkers.filter((c) => c.image).slice(0, 5),
    [sortedCoworkers],
  );
  const socialProofLabel = t("socialProofFallback");

  const q = query.trim().toLowerCase();

  // A coworker is relevant if their own text (incl. description + capabilities)
  // matches, OR any of their offers match. Surface all their offers when the
  // coworker matched directly, otherwise just the matching offers. Then group by
  // company (priority-sorted, so Serviceplan/Elena lead).
  const vendorGroups = useMemo(() => {
    const map = new Map<
      string,
      { vendor: Coworker["vendor"]; coworkers: Coworker[]; offers: OfferItem[] }
    >();
    for (const coworker of sortedCoworkers) {
      const allOffers: OfferItem[] = (coworker.metadata?.offers ?? []).map(
        (offer) => ({ offer, coworker }),
      );
      let offers = allOffers;
      if (q) {
        const profile = coworker.metadata?.profile;
        const coworkerText = [
          coworker.name,
          coworker.vendor.name,
          coworker.caption ?? "",
          coworker.description ?? "",
          ...(profile?.capabilities ?? []),
          ...(profile?.examples ?? []),
        ]
          .join(" ")
          .toLowerCase();
        const coworkerMatches = coworkerText.includes(q);
        const matchingOffers = allOffers.filter((item) =>
          `${item.offer.title} ${item.offer.description ?? ""} ${item.offer.category ?? ""} ${item.offer.deliverable ?? ""}`
            .toLowerCase()
            .includes(q),
        );
        if (!coworkerMatches && matchingOffers.length === 0) continue;
        offers = coworkerMatches ? allOffers : matchingOffers;
      }
      const key = coworker.vendor.id;
      let group = map.get(key);
      if (!group) {
        group = { vendor: coworker.vendor, coworkers: [], offers: [] };
        map.set(key, group);
      }
      group.coworkers.push(coworker);
      group.offers.push(...offers);
    }
    return Array.from(map.values());
  }, [sortedCoworkers, q]);

  if (!coworkers.length) {
    return null;
  }

  // While searching, show everything; otherwise cap the number of companies.
  const isSearching = q !== "";
  const visibleGroups =
    showAllCompanies || isSearching
      ? vendorGroups
      : vendorGroups.slice(0, VENDOR_CAP);
  const canShowMoreCompanies = !isSearching && vendorGroups.length > VENDOR_CAP;

  return (
    <section className="space-y-12 md:space-y-16">
      {/* Hero search — full-bleed header band, same surface as the page below */}
      <div className="border-border/60 -mx-6 -mt-4 border-b px-6 py-12 md:py-16">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 text-center">
          {socialAvatars.length > 0 ? (
            <div className="flex items-center gap-2.5">
              <div className="flex -space-x-2">
                {socialAvatars.map((coworker) => (
                  <CoworkerAvatar
                    key={coworker.id}
                    coworker={coworker}
                    className="ring-background size-7 rounded-full ring-2"
                    sizes="28px"
                  />
                ))}
              </div>
              <span className="text-muted-foreground text-sm font-medium">
                {socialProofLabel}
              </span>
            </div>
          ) : null}
          <h2 className="text-foreground text-2xl font-light text-balance md:text-3xl">
            {t("heroHeadline")}
          </h2>
          {/* Brand gradient ring + soft glow; intensifies on focus. */}
          <div className="from-primary/50 to-[#00a4fa]/50 focus-within:from-primary focus-within:to-[#00a4fa] shadow-primary/15 focus-within:shadow-primary/30 relative w-full max-w-xl rounded-full bg-gradient-to-r p-[1.5px] shadow-lg transition-all duration-300 focus-within:shadow-xl">
            <div className="relative rounded-full">
              <Search
                aria-hidden
                className="text-background/60 pointer-events-none absolute top-1/2 left-5 size-5 -translate-y-1/2 transition-colors"
              />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                onBlur={() => setIsSearchFocused(false)}
                placeholder=""
                aria-label={t("searchHint")}
                className="bg-foreground text-background h-14 w-full rounded-full pr-5 pl-13 text-base outline-none md:text-lg"
              />
              {/* Animated rotating placeholder (hidden while typing/focused) */}
              {query === "" && !isSearchFocused ? (
                <div
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 right-5 left-13 -translate-y-1/2 overflow-hidden text-left"
                >
                  <span
                    key={hintIdx}
                    className="text-background/55 animate-in fade-in slide-in-from-bottom-1.5 block truncate text-base duration-500 md:text-lg"
                  >
                    {rotatingHints[hintIdx % rotatingHints.length]}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
          {suggestions.length > 0 ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setQuery(suggestion)}
                  className={cn(
                    "bg-card border-border/60 text-muted-foreground hover:text-foreground hover:border-border rounded-full border px-3 py-1.5 text-sm transition-colors",
                    FOCUS_RING,
                  )}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {vendorGroups.length > 0 ? (
        <div className="space-y-8">
          <h2 className="text-foreground text-xl font-light md:text-2xl">
            {t("coworkersTitle")}
          </h2>
          <div>
            {visibleGroups.map(
              ({ vendor, coworkers: members, offers }, index) => (
                <VendorDashboard
                  key={vendor.id}
                  vendor={vendor}
                  members={members}
                  offers={offers}
                  isFirst={index === 0}
                  labels={{
                    count: t("coworkerCount", { count: members.length }),
                    website: t("companyWebsite"),
                    legal: t("companyLegal"),
                    other: t("otherCompanyLabel"),
                    offersTitle: t("offersSectionTitle"),
                    startForCoworker: (name: string) =>
                      t("startForCoworker", { name }),
                    noOffers: t("coworkerNoOffers"),
                    showAllOffers: (count: number) =>
                      t("showAllOffers", { count }),
                    showLess: t("showLess"),
                  }}
                  typeLabel={getTypeLabel}
                  onOpenOffer={setSelected}
                  onStartTask={handleOpenWith}
                />
              ),
            )}
          </div>
          {canShowMoreCompanies ? (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setShowAllCompanies((value) => !value)}
                className={cn(
                  "border-border/60 bg-card text-foreground hover:bg-muted/60 inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
                  FOCUS_RING,
                )}
              >
                {showAllCompanies
                  ? t("showLess")
                  : t("showMoreCompanies", {
                      count: vendorGroups.length - VENDOR_CAP,
                    })}
                {showAllCompanies ? (
                  <ChevronUp aria-hidden className="size-4" />
                ) : (
                  <ChevronDown aria-hidden className="size-4" />
                )}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <OfferDetailDialog
        item={
          selected
            ? ({
                offer: selected.offer,
                coworkerName: selected.coworker.name,
                coworkerCaption: selected.coworker.caption ?? undefined,
                vendor: selected.coworker.vendor,
                coworkerAvatar: (
                  <CoworkerAvatar
                    coworker={selected.coworker}
                    className="size-11 rounded-full"
                    sizes="44px"
                  />
                ),
                metaTags: <MetaTags coworker={selected.coworker} />,
              } satisfies OfferDetailItem)
            : null
        }
        onClose={() => setSelected(null)}
        onStart={
          hasAssignedSeat
            ? () => {
                if (selected) {
                  handleOpenWith(selected.coworker.id, selected.offer.prompt);
                }
                setSelected(null);
              }
            : undefined
        }
        labels={{
          deliveredBy: t("deliveredByLabel"),
          deliverable: t("deliverableLabel"),
          start: t("startThisTask"),
          pending: t("examplePendingHint"),
          openInNewTab: t("openInNewTab"),
          fallbackTitle: t("offerDetails"),
        }}
        typeLabel={getTypeLabel}
      />
    </section>
  );
}

export { CoworkerGallerySection };
