import type { Coworker } from "@sokosumi/core-client";
import { ArrowRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { CoworkerAvatar } from "@/components/agents/coworker-avatar";
import { AgentStatus } from "@/components/agents/directory/agent-status";
import {
  AGENT_TILE_GRID_CLASS,
  AgentTile,
} from "@/components/agents/directory/agent-tile";
import { RefreshPrefetchedPage } from "@/components/refresh-prefetched-page.client";
import { BotFace } from "@/components/soko-bot/bot-face";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
} from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { mapAgentListItemToCatalogBrowseAgent } from "@/lib/agents/catalog-browse-agent";
import { SOKO_BOT_ROUTE, SOKO_BOTS_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

import {
  loadAgentsBotDirectory,
  loadAgentsCatalog,
  loadAgentsCoworkers,
} from "./agents-page-data";
import {
  botName,
  botOwnerLabel,
  botPurpose,
  botStatusLabel,
} from "./bot-labels";
import { Marketplace } from "./components/marketplace.client";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Agents.Metadata");
  return { title: t("title"), description: t("description") };
}

function Section({
  id,
  title,
  note,
  tag,
  action,
  children,
}: {
  id: string;
  title: string;
  note: string;
  tag?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 px-1">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2
              id={id}
              className="text-foreground text-lg font-semibold tracking-tight"
            >
              {title}
            </h2>
            {tag ? (
              <span className="border-border text-muted-foreground rounded-full border px-2 py-0.5 text-xs font-medium">
                {tag}
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground text-sm text-pretty">{note}</p>
        </div>
        {action}
      </div>
      <div className={HOLDER_CLASS}>{children}</div>
    </section>
  );
}

function SectionLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-md text-sm font-medium outline-none focus-visible:ring-2"
    >
      {children}
      <ArrowRight aria-hidden className="size-3.5" />
    </Link>
  );
}

function TilesSkeleton() {
  return (
    <div className={AGENT_TILE_GRID_CLASS}>
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-32 w-full rounded-lg" />
      ))}
    </div>
  );
}

async function SokoBotsSection() {
  const [t, directory] = await Promise.all([
    getTranslations("App.Agents.Directory"),
    loadAgentsBotDirectory(),
  ]);

  return (
    <Section
      id="agents-soko-bots"
      title={t("sokoBotsTitle")}
      note={t("sokoBotsNote")}
      action={
        <SectionLink href={SOKO_BOTS_ROUTE}>{t("manageSokoBots")}</SectionLink>
      }
    >
      {!directory ? (
        <p className="text-muted-foreground px-2 py-6 text-center text-sm">
          {t("sokoBotsUnavailable")}
        </p>
      ) : (
        <ul className={AGENT_TILE_GRID_CLASS}>
          {directory.bots.map((bot) => (
            <li key={bot.id}>
              <AgentTile
                href={`/agents/soko-bots/${encodeURIComponent(bot.id)}`}
                avatar={
                  <BotFace
                    imageUrl={bot.avatarImageUrl}
                    seed={bot.seed}
                    className="size-10"
                  />
                }
                name={botName(bot, t)}
                purpose={botPurpose(bot, t)}
                meta={botOwnerLabel(bot, t)}
                status={
                  <AgentStatus
                    status={bot.status}
                    label={botStatusLabel(bot, t)}
                  />
                }
              />
            </li>
          ))}
          {directory.hasOwnBot ? null : (
            <li>
              <Link
                href={SOKO_BOT_ROUTE}
                className={cn(
                  HOLDER_ITEM_CLASS,
                  "press hover:bg-accent focus-visible:ring-ring flex h-full min-h-32 flex-col items-start justify-center gap-1 border-dashed p-4 transition-colors outline-none focus-visible:ring-2",
                )}
              >
                <span className="text-foreground flex items-center gap-2 font-medium">
                  <Plus aria-hidden className="size-4" />
                  {t("createOwnBot")}
                </span>
                <span className="text-muted-foreground text-sm">
                  {t("createOwnBotHint")}
                </span>
              </Link>
            </li>
          )}
        </ul>
      )}
    </Section>
  );
}

function coworkerMeta(coworker: Coworker): string {
  return coworker.vendor.name;
}

async function CoworkersSection() {
  const [t, coworkers] = await Promise.all([
    getTranslations("App.Agents.Directory"),
    loadAgentsCoworkers(),
  ]);
  const sorted = [...coworkers].sort(
    (a, b) =>
      (b.priority ?? 0) - (a.priority ?? 0) || a.name.localeCompare(b.name),
  );

  return (
    <Section
      id="agents-coworkers"
      title={t("coworkersTitle")}
      note={t("coworkersNote")}
    >
      {sorted.length === 0 ? (
        <p className="text-muted-foreground px-2 py-6 text-center text-sm">
          {t("coworkersEmpty")}
        </p>
      ) : (
        <ul className={AGENT_TILE_GRID_CLASS}>
          {sorted.map((coworker) => (
            <li key={coworker.id}>
              <AgentTile
                href={`/agents/coworkers/${encodeURIComponent(coworker.id)}`}
                avatar={
                  <CoworkerAvatar
                    coworker={coworker}
                    className="size-10"
                    sizes="40px"
                  />
                }
                name={coworker.name}
                purpose={coworker.caption ?? coworker.description ?? null}
                meta={coworkerMeta(coworker)}
              />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

async function MarketplaceSection() {
  const [t, listItems] = await Promise.all([
    getTranslations("App.Agents.Directory"),
    loadAgentsCatalog(),
  ]);

  return (
    <Section
      id="agents-marketplace"
      title={t("marketplaceTitle")}
      tag={t("external")}
      note={t("marketplaceNote")}
      action={
        <SectionLink href="/developer/coworkers">
          {t("bringYourOwn")}
        </SectionLink>
      }
    >
      <Marketplace
        agents={listItems.map(mapAgentListItemToCatalogBrowseAgent)}
      />
    </Section>
  );
}

function SectionFallback({ title }: { title: string }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 px-1">
        <h2 className="text-foreground text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <Skeleton className="h-4 w-64" />
      </div>
      <div className={HOLDER_CLASS}>
        <TilesSkeleton />
      </div>
    </section>
  );
}

/**
 * Three sections, one card: the workspace's Soko Bots, its Coworkers, and
 * the external agents of the marketplace.
 */
export default async function AgentsPage() {
  const t = await getTranslations("App.Agents.Directory");

  return (
    <div className="flex w-full flex-col gap-12 pb-12 md:px-2 md:pt-2">
      <RefreshPrefetchedPage />
      <header className="flex flex-col gap-1 px-1">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight md:text-3xl">
          {t("title")}
        </h1>
        <p className="text-muted-foreground text-sm md:text-base">
          {t("subtitle")}
        </p>
      </header>
      <Suspense fallback={<SectionFallback title={t("sokoBotsTitle")} />}>
        <SokoBotsSection />
      </Suspense>
      <Suspense fallback={<SectionFallback title={t("coworkersTitle")} />}>
        <CoworkersSection />
      </Suspense>
      <Suspense fallback={<SectionFallback title={t("marketplaceTitle")} />}>
        <MarketplaceSection />
      </Suspense>
    </div>
  );
}
