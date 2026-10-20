import { type SharedSokoBotSummary, SokoBotScope } from "@sokosumi/core-client";
import { ArrowRight, MessageSquare } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
} from "@/components/ui/holder-surface";
import { sokoBotConsoleRoute } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

import { BotFace } from "./bot-face";
import {
  CreateSokoBotDialog,
  type CreateSokoBotProject,
} from "./create-soko-bot-dialog.client";
import { SectionHeader } from "./roster";
import { SokoBotStatusChip } from "./soko-bot-status-chip";

type Translate = Awaited<ReturnType<typeof getTranslations<"App.SokoBots">>>;

interface SharedBotsSectionProps {
  /** Core's `sharedBots`; the page renders this section only when present. */
  bots: SharedSokoBotSummary[];
  /** Names for project bots, and the choices of the create dialog. */
  projects: CreateSokoBotProject[];
  canCreatePersonal: boolean;
  defaultScope: SokoBotScope;
  defaultProjectId?: string | null;
  title: string;
}

function scopeLabel(
  bot: SharedSokoBotSummary,
  projects: CreateSokoBotProject[],
  t: Translate,
): string {
  if (bot.scope === SokoBotScope.WORKSPACE) return t("Shared.scopeWorkspace");
  const project = projects.find((entry) => entry.id === bot.projectId);
  return project
    ? t("Shared.scopeProjectNamed", { project: project.name })
    : t("Shared.scopeProject");
}

function SharedBotCard({
  bot,
  projects,
  t,
  tStatus,
}: {
  bot: SharedSokoBotSummary;
  projects: CreateSokoBotProject[];
  t: Translate;
  tStatus: (key: SharedSokoBotSummary["status"]) => string;
}) {
  const name = bot.name?.trim() || t("Shared.fallbackName");
  const archived = bot.archivedAt !== null;
  return (
    <li
      className={cn(
        HOLDER_ITEM_CLASS,
        "flex flex-col gap-3 p-3",
        archived && "opacity-70",
      )}
    >
      <Link
        href={sokoBotConsoleRoute(bot.id)}
        className={cn(
          HOLDER_ITEM_HOVER_CLASS,
          "focus-visible:ring-ring -m-1 flex min-w-0 items-center gap-3 rounded-md p-1 outline-none focus-visible:ring-2",
        )}
      >
        <BotFace bot={bot} ownerId={bot.id} className="size-10" />
        <span className="min-w-0 flex-1">
          <span className="text-foreground block truncate font-medium">
            {name}
          </span>
          <span className="text-muted-foreground block truncate text-sm">
            {scopeLabel(bot, projects, t)}
          </span>
        </span>
        {archived ? (
          <span className="text-muted-foreground shrink-0 text-xs">
            {t("Shared.archived")}
          </span>
        ) : (
          <SokoBotStatusChip
            status={bot.status}
            label={tStatus(bot.status)}
            size="sm"
          />
        )}
      </Link>
      <div className="border-border mt-auto flex items-center justify-between gap-2 border-t pt-2.5">
        {bot.sharedRoomId && !archived ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={`/chat/rooms/${encodeURIComponent(bot.sharedRoomId)}`}>
              <MessageSquare aria-hidden className="size-3.5" />
              {t("chat")}
            </Link>
          </Button>
        ) : (
          <span />
        )}
        <Button asChild variant="ghost" size="sm">
          <Link
            href={sokoBotConsoleRoute(bot.id)}
            aria-label={t("Shared.openBot", { name })}
          >
            {t("manage")}
            <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        </Button>
      </div>
    </li>
  );
}

/**
 * Project and workspace bots: everyone in the organization talks to them in
 * one room and may configure them. Owners and admins archive and delete.
 */
export async function SharedBotsSection({
  bots,
  projects,
  canCreatePersonal,
  defaultScope,
  defaultProjectId = null,
  title,
}: SharedBotsSectionProps) {
  const [t, tStatus] = await Promise.all([
    getTranslations("App.SokoBots"),
    getTranslations("Components.SokoBot.BotStatus"),
  ]);

  return (
    <section className="space-y-6" data-testid="shared-bots-section">
      <SectionHeader
        title={title}
        note={
          bots.length > 0
            ? t("Shared.count", { count: bots.length })
            : undefined
        }
      />
      <div className={cn(HOLDER_CLASS, "flex flex-col gap-2")}>
        {bots.length > 0 ? (
          <ul className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(16.25rem,1fr))]">
            {bots.map((bot) => (
              <SharedBotCard
                key={bot.id}
                bot={bot}
                projects={projects}
                t={t}
                tStatus={tStatus}
              />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground px-2 py-1 text-sm">
            {t("Shared.empty")}
          </p>
        )}
        <div className="px-1 pb-1">
          <CreateSokoBotDialog
            canCreatePersonal={canCreatePersonal}
            projects={projects}
            defaultScope={defaultScope}
            defaultProjectId={defaultProjectId}
          />
        </div>
      </div>
    </section>
  );
}
