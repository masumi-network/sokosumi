import { type Coworker, SokoBotScope } from "@sokosumi/core-client";
import type { Metadata } from "next";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { OpenCoworkerRoomProvider } from "@/app/chat/components/landing/use-open-coworker-room";
import { coworkerCanChat } from "@/app/chat/utils/coworker-utils";
import { PersonAvatar } from "@/app/contacts/components/contact-visuals";
import { CreateSokoBotDialog } from "@/app/soko-bots/components/create-soko-bot-dialog.client";
import { ArchivedBotRows } from "@/app/soko-bots/components/managed-bot-sections";
import {
  loadSokoBotsManagement,
  type ManagedBot,
} from "@/app/soko-bots/managed-bots";
import { CoworkerAvatar } from "@/components/agents/coworker-avatar";
import { AgentStatus } from "@/components/agents/directory/agent-status";
import {
  AGENT_TILE_GRID_CLASS,
  AgentTile,
} from "@/components/agents/directory/agent-tile";
import {
  AgentsSection,
  AgentsSectionLink,
  AgentsTag,
} from "@/components/agents/directory/agents-page";
import { AGENTS_PAGE_CLASS } from "@/components/agents/directory/agents-page-classes";
import { RefreshPrefetchedPage } from "@/components/refresh-prefetched-page.client";
import { BotFace } from "@/components/soko-bot/bot-face";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
} from "@/components/ui/holder-surface";
import { Skeleton } from "@/components/ui/skeleton";
import { mapAgentListItemToCatalogBrowseAgent } from "@/lib/agents/catalog-browse-agent";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";
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
import { ArchivedFold } from "./components/archived-fold.client";
import { BotManageMenu } from "./components/bot-manage-menu.client";
import {
  BotCardAction,
  CoworkerCardAction,
} from "./components/card-actions.client";
import { Marketplace } from "./components/marketplace.client";
import { NotSetUpLine } from "./components/not-set-up-line";
import type { DirectoryBot } from "./soko-bot-directory";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("App.Agents.Metadata");
  return { title: t("title"), description: t("description") };
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

type DirectoryT = Awaited<
  ReturnType<typeof getTranslations<"App.Agents.Directory">>
>;

function isPersonal(bot: DirectoryBot): boolean {
  return bot.owner.kind === "you" || bot.owner.kind === "person";
}

/** "Phil's" with Phil's picture; a shared bot's team or project as text. */
function BotOwner({ bot, t }: { bot: DirectoryBot; t: DirectoryT }) {
  const owner = bot.owner;
  return (
    <>
      {owner.kind === "you" || owner.kind === "person" ? (
        <PersonAvatar person={owner} className="size-5" />
      ) : null}
      <span className="min-w-0 truncate">{botOwnerLabel(bot, t)}</span>
    </>
  );
}

/** One group of bot cards under a small label: Personal, or Team and projects. */
function BotGroup({
  label,
  bots,
  managed,
  t,
  pausedLabel,
  children,
}: {
  label: string;
  bots: DirectoryBot[];
  /** The bots the viewer configures, by id; others get no menu. */
  managed: Map<string, ManagedBot>;
  t: DirectoryT;
  /** The "Paused" tag's text. */
  pausedLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-muted-foreground px-2 pt-1 text-xs font-medium">
        {label}
      </h3>
      <ul className={AGENT_TILE_GRID_CLASS}>
        {bots.map((bot) => (
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
              meta={<BotOwner bot={bot} t={t} />}
              status={
                <span className="flex items-center gap-1.5">
                  {managed.get(bot.id)?.paused ? (
                    <AgentsTag>{pausedLabel}</AgentsTag>
                  ) : null}
                  <AgentStatus
                    status={bot.status}
                    label={botStatusLabel(bot, t)}
                  />
                </span>
              }
              action={
                <BotActions
                  bot={bot}
                  managed={managed.get(bot.id)}
                  name={botName(bot, t)}
                />
              }
            />
          </li>
        ))}
        {children}
      </ul>
    </div>
  );
}

/** Message, and the "…" menu on the bots the viewer configures. */
function BotActions({
  bot,
  managed,
  name,
}: {
  bot: DirectoryBot;
  managed: ManagedBot | undefined;
  name: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <BotCardAction
        botId={bot.id}
        botName={name}
        shared={!isPersonal(bot)}
        sharedRoomId={bot.sharedRoomId}
        iconOnly={Boolean(managed)}
      />
      {managed ? (
        <BotManageMenu
          name={name}
          settingsHref={managed.settingsHref}
          botId={managed.targetId}
          paused={managed.paused}
          canArchive={managed.canArchive}
        />
      ) : null}
    </div>
  );
}

const INVITERS = new Set(["owner", "admin"]);

async function SokoBotsSection() {
  const [t, tSoko, format, directory, management] = await Promise.all([
    getTranslations("App.Agents.Directory"),
    getTranslations("App.SokoBots"),
    getFormatter(),
    loadAgentsBotDirectory(),
    loadSokoBotsManagement(),
  ]);
  const personal = directory?.bots.filter(isPersonal) ?? [];
  const shared = directory?.bots.filter((bot) => !isPersonal(bot)) ?? [];
  const managed = new Map(
    management.bots
      .filter((bot) => bot.archivedAt === null)
      .map((bot) => [bot.id, bot]),
  );
  const archived = management.bots.filter((bot) => bot.archivedAt !== null);
  const { team, projects } = management;
  const me = team?.members.find((member) => member.isYou) ?? null;

  return (
    <AgentsSection
      id="agents-soko-bots"
      title={t("sokoBotsTitle")}
      note={t("sokoBotsNote")}
      action={
        directory && projects ? (
          <CreateSokoBotDialog
            canCreatePersonal={!directory.hasOwnBot}
            projects={projects}
            defaultScope={SokoBotScope.WORKSPACE}
          />
        ) : null
      }
    >
      {!directory ? (
        <p className="text-muted-foreground px-2 py-6 text-center text-sm">
          {t("sokoBotsUnavailable")}
        </p>
      ) : (
        <>
          <BotGroup
            label={t("groupPersonal")}
            bots={personal}
            managed={managed}
            t={t}
            pausedLabel={tSoko("paused")}
          >
            {directory.hasOwnBot ? null : (
              <li>
                <Link
                  href={SOKO_BOT_ROUTE}
                  className={cn(
                    HOLDER_ITEM_CLASS,
                    HOLDER_ITEM_HOVER_CLASS,
                    "group press focus-visible:ring-ring flex h-full min-h-32 flex-col items-start gap-3 p-4 outline-none focus-visible:ring-2",
                  )}
                >
                  <span className="text-foreground text-sm text-pretty">
                    {t("createOwnBotHint")}
                  </span>
                  {/* The tile is the link; this only paints its action. */}
                  <span className="bg-primary text-primary-foreground group-hover:bg-primary-hover mt-auto inline-flex h-8 items-center rounded-md px-3 text-sm font-medium transition-colors">
                    {t("createOwnBot")}
                  </span>
                </Link>
              </li>
            )}
          </BotGroup>
          {shared.length > 0 ? (
            <BotGroup
              label={t("groupShared")}
              bots={shared}
              managed={managed}
              t={t}
              pausedLabel={tSoko("paused")}
            />
          ) : null}
          {archived.length > 0 ? (
            <ArchivedFold
              label={tSoko("archivedTitle")}
              count={format.number(archived.length)}
            >
              <ArchivedBotRows
                bots={archived}
                t={tSoko}
                tDir={t}
                format={format}
              />
            </ArchivedFold>
          ) : null}
          {team?.workspace.kind === "organization" ? (
            <NotSetUpLine
              others={team.members.filter((member) => !member.isYou)}
              canInvite={INVITERS.has(me?.role ?? "")}
            />
          ) : null}
        </>
      )}
    </AgentsSection>
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
    <AgentsSection
      id="agents-coworkers"
      title={t("coworkersTitle")}
      note={t("coworkersNote")}
    >
      {sorted.length === 0 ? (
        <p className="text-muted-foreground px-2 py-6 text-center text-sm">
          {t("coworkersEmpty")}
        </p>
      ) : (
        <OpenCoworkerRoomProvider>
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
                  action={
                    <CoworkerCardAction
                      coworkerId={coworker.id}
                      coworkerName={coworker.name}
                      canChat={coworkerCanChat(coworker)}
                    />
                  }
                />
              </li>
            ))}
          </ul>
        </OpenCoworkerRoomProvider>
      )}
    </AgentsSection>
  );
}

async function MarketplaceSection() {
  const [t, listItems] = await Promise.all([
    getTranslations("App.Agents.Directory"),
    loadAgentsCatalog(),
  ]);

  return (
    <AgentsSection
      id="agents-marketplace"
      title={t("marketplaceTitle")}
      tag={t("external")}
      note={t("marketplaceNote")}
      action={
        <AgentsSectionLink href="/developer/coworkers">
          {t("bringYourOwn")}
        </AgentsSectionLink>
      }
    >
      <Marketplace
        agents={listItems.map(mapAgentListItemToCatalogBrowseAgent)}
      />
    </AgentsSection>
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
    <div className={AGENTS_PAGE_CLASS}>
      <RefreshPrefetchedPage />
      <h1 className="sr-only">{t("title")}</h1>
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
