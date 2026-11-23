"use client";

import type { Coworker } from "@sokosumi/core-client";
import { ArrowRight, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { StartChatButton } from "@/app/chat/components/landing/start-chat-button.client";
import { OpenCoworkerRoomProvider } from "@/app/chat/components/landing/use-open-coworker-room";
import { coworkerCanChat } from "@/app/chat/utils/coworker-utils";
import { useCreateTaskModal } from "@/app/tasks/components/create-task-modal";
import { COWORKER_FALLBACK_IMAGES } from "@/app/tasks/utils/coworker-fallback-images";
import {
  groupCoworkerSearchResults,
  type OfferItem,
} from "@/components/agents/coworker-gallery-results";
import { CoworkerGallerySearch } from "@/components/agents/coworker-gallery-search";
import {
  GalleryGroupHeading,
  GalleryResultsStatus,
} from "@/components/agents/gallery-group-heading";
import {
  GALLERY_DIVIDER_CLASS,
  GALLERY_HERO_BAND_CLASS,
  GALLERY_HERO_HEADLINE_CLASS,
  GALLERY_HERO_INNER_CLASS,
  GALLERY_SOCIAL_PROOF_CAPTION_CLASS,
  GALLERY_SOCIAL_PROOF_FACE_CLASS,
} from "@/components/agents/gallery-page-classes";
import {
  OfferCard,
  OfferDetailDialog,
  type OfferDetailItem,
  type OutputKind,
} from "@/components/agents/offer-card";
import { TagIcon } from "@/components/agents/tag-icon";
import { VendorMark } from "@/components/agents/vendor-mark";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { canUseNextImageSrc } from "@/config/next-image";
import { useHasAssignedOrganizationSeat } from "@/contexts/organization-seat-context";
import useGalleryFilter from "@/hooks/use-gallery-filter";
import { GALLERY_SCOPES } from "@/lib/agents/gallery-filter";
import { cn } from "@/lib/utils";
import { regionFlag } from "@/lib/utils/region-flag";

interface CoworkerGallerySectionProps {
  coworkers: Coworker[];
}

const FOCUS_RING =
  "focus-visible:ring-ring focus-visible:inset-ring-1 focus-visible:inset-ring-ring outline-none focus-visible:ring-2";

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
          className="bg-senary text-muted-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
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
        <span className="bg-senary text-muted-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium">
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
      <div aria-hidden className={GALLERY_DIVIDER_CLASS} />

      {/* Master–detail. The detail column's left border is the divider; both
          columns pad to the bottom so it reaches the closing rule below. */}
      <div className="grid gap-6 md:grid-cols-[13.5rem_1fr] md:gap-0">
        {/* Rail — coworker selector (horizontal on mobile, vertical list on desktop) */}
        <div className="app-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 pt-6 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0 md:pt-6 md:pr-6 md:pb-10">
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
                  isActive ? "bg-muted" : "hover:bg-accent",
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
        <div className="space-y-5 md:border-border md:border-l md:pt-6 md:pb-10 md:pl-9">
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
              {coworkerCanChat(active) ? (
                <StartChatButton
                  coworkerId={active.id}
                  coworkerName={active.name}
                  variant="outline"
                  className="w-full sm:w-auto"
                />
              ) : null}
              {hasAssignedSeat ? (
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
              ) : null}
            </div>
          </div>

          {active.description ? (
            <p className="text-foreground text-sm leading-relaxed text-pretty">
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
                      "text-muted-foreground press hover:text-foreground inline-flex items-center gap-1 rounded-md text-sm font-medium",
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
      <div aria-hidden className={GALLERY_DIVIDER_CLASS} />
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
  const tScope = useTranslations("App.Agents.FilterSection.scope");
  const hasAssignedSeat = useHasAssignedOrganizationSeat();
  const getTypeLabel = (type: OutputKind) => t(`outputTypes.${type}`);
  // The page's one search; the agent catalog below filters by it too.
  const { query, setQuery, scope, setScope } = useGalleryFilter();
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
  const vendorGroups = useMemo(
    () => groupCoworkerSearchResults(sortedCoworkers, q),
    [sortedCoworkers, q],
  );

  // No early return without coworkers: the hero holds the page's only search
  // and Show control, which the agent catalog needs too.
  // While searching, show everything; otherwise cap the number of companies.
  const isSearching = q !== "";
  const visibleGroups =
    showAllCompanies || isSearching
      ? vendorGroups
      : vendorGroups.slice(0, VENDOR_CAP);
  const canShowMoreCompanies = !isSearching && vendorGroups.length > VENDOR_CAP;
  const matchingCoworkers = vendorGroups.reduce(
    (total, group) => total + group.coworkers.length,
    0,
  );

  return (
    <section className="space-y-12 md:space-y-16">
      {/* Hero search — full-bleed header band, same surface as the page below */}
      <div className={GALLERY_HERO_BAND_CLASS}>
        <div className={GALLERY_HERO_INNER_CLASS}>
          {socialAvatars.length > 0 ? (
            <div className="flex items-center gap-2.5">
              <div className="flex -space-x-2">
                {socialAvatars.map((coworker) => (
                  <CoworkerAvatar
                    key={coworker.id}
                    coworker={coworker}
                    className={GALLERY_SOCIAL_PROOF_FACE_CLASS}
                    sizes="28px"
                  />
                ))}
              </div>
              <span className={GALLERY_SOCIAL_PROOF_CAPTION_CLASS}>
                {socialProofLabel}
              </span>
            </div>
          ) : null}
          <h2 className={GALLERY_HERO_HEADLINE_CLASS}>{t("heroHeadline")}</h2>
          <CoworkerGallerySearch
            query={query}
            setQuery={(value) => void setQuery(value)}
            suggestions={suggestions}
          />
          <ToggleGroup
            type="single"
            aria-label={tScope("label")}
            value={scope}
            onValueChange={(next) => {
              const match = GALLERY_SCOPES.find((option) => option === next);
              if (match) void setScope(match);
            }}
          >
            {GALLERY_SCOPES.map((option) => (
              // flex-none: each option sizes to its label and keeps its px-3.
              <ToggleGroupItem
                key={option}
                value={option}
                className="flex-none"
              >
                {tScope(option)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <GalleryResultsStatus
            message={
              isSearching && scope !== "agents"
                ? t("coworkersFound", { count: matchingCoworkers })
                : scope === "coworkers" && vendorGroups.length === 0
                  ? t("noCoworkers")
                  : ""
            }
          />
          {suggestions.length > 0 ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void setQuery(suggestion)}
                  className={cn(
                    "bg-card border-border text-muted-foreground press hover:text-foreground rounded-full border px-3 py-1.5 text-sm transition-colors",
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

      {/* A search that misses every coworker keeps the group heading (· 0) and
          says so, as the agent catalog below does; under All the group
          otherwise vanished and left only a gap. */}
      {scope !== "agents" && (vendorGroups.length > 0 || isSearching) ? (
        <div className="space-y-8">
          <GalleryGroupHeading
            title={t("coworkersTitle")}
            count={isSearching ? matchingCoworkers : undefined}
          />
          {vendorGroups.length === 0 ? (
            <p className="text-muted-foreground text-center text-sm">
              {t("noResults")}
            </p>
          ) : null}
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
                  "border-border bg-card text-foreground press hover:bg-card-background inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
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
      ) : scope === "coworkers" ? (
        <p className="text-muted-foreground text-center text-sm">
          {t("noCoworkers")}
        </p>
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
