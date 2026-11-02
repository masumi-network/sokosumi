"use client";

import { Bot, ChevronDown, PenLine, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";

import { ensureSokoBotDirectRoomAction } from "@/app/chat/actions";
import {
  composeDraftKey,
  getComposeDraft,
  setComposeDraft,
} from "@/app/chat/utils/compose-draft-storage";
import { RequireProjectScope } from "@/app/components/project-scope/project-scope-required";
import {
  openProjectScope,
  type ProjectScopeRequest,
} from "@/app/components/project-scope/sidebar-project-scope-state";
import { useSocialCompose } from "@/app/social/components/social-compose-context";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";

interface SocialNewPostMenuProps {
  /** The scoped project, or null on the all-projects view. */
  project: { id: string; name: string } | null;
  /** The signed-in user's Soko Bot, or null when they have none yet. */
  sokoBotId: string | null;
}

/**
 * Social's one way to start a post: write it in the composer, or hand it to
 * Soko Bot in chat. Soko Bot is the only coworker that can post today, so it
 * is named rather than offered as a generic "agent".
 *
 * Writing needs a project, because a post goes out from the accounts one
 * project connected; with none in scope the header's project selector asks for
 * one first and reopens Social there with the composer up. Soko Bot does not
 * need one: it can ask in the conversation.
 */
export function SocialNewPostMenu({
  project,
  sokoBotId,
}: SocialNewPostMenuProps) {
  const t = useTranslations("App.Social.newPost");
  const router = useRouter();
  const compose = useSocialCompose();
  const [isOpeningChat, startOpeningChat] = useTransition();
  const projectRequest: ProjectScopeRequest = {
    reason: t("chooseProjectBody"),
    onSelect: (projectId) => {
      const query = new URLSearchParams({ projectId, compose: "new" });
      if (compose?.scheduledAt) query.set("composeAt", compose.scheduledAt);
      router.push(`/social?${query}`);
    },
    // Closing without a project drops the composer that asked for one.
    onDismiss: () => compose?.setOpen(false),
  };

  function writeManually() {
    // With no project in scope, the open composer asks for one below.
    if (compose) {
      compose.setOpen(true);
      return;
    }
    if (!project) openProjectScope({ ...projectRequest, required: true });
  }

  function postWithSokoBot() {
    if (!sokoBotId) {
      router.push(SOKO_BOT_ROUTE);
      return;
    }
    startOpeningChat(async () => {
      const room = await ensureSokoBotDirectRoomAction(sokoBotId);
      if (!room.ok || !room.value) {
        toast.error(t("sokoBotFailed"));
        return;
      }
      // Prefill, never send: the reader says what the post is about. A draft
      // they already left in that chat wins over ours.
      const key = composeDraftKey.room(room.value.id);
      if (!getComposeDraft(key)?.text) {
        setComposeDraft(key, {
          text: project
            ? t("sokoBotPrompt", { project: project.name })
            : t("sokoBotPromptAnyProject"),
          attachments: [],
        });
      }
      router.push(`/chat/rooms/${encodeURIComponent(room.value.id)}`);
    });
  }

  return (
    <>
      <DropdownMenu>
        {/* Disabled on the trigger, not the button: a loading button drops
            native `disabled`, and only the trigger's own flag stops Radix
            from opening the menu. */}
        <DropdownMenuTrigger asChild disabled={isOpeningChat}>
          <Button
            type="button"
            size="sm"
            className="h-11 shrink-0 md:h-10"
            loading={isOpeningChat}
          >
            <Plus className="size-4" aria-hidden />
            <span className="sr-only md:not-sr-only">{t("label")}</span>
            <ChevronDown className="hidden size-4 md:block" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuItem
            className="min-h-11 items-start"
            onSelect={writeManually}
          >
            <PenLine className="mt-0.5 size-4" aria-hidden />
            <span className="flex flex-col gap-0.5">
              <span>{t("manual")}</span>
              <span className="text-muted-foreground text-xs">
                {t("manualHint")}
              </span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="min-h-11 items-start"
            onSelect={postWithSokoBot}
          >
            <Bot className="mt-0.5 size-4" aria-hidden />
            <span className="flex flex-col gap-0.5">
              <span>{t("sokoBot")}</span>
              <span className="text-muted-foreground text-xs">
                {sokoBotId ? t("sokoBotHint") : t("sokoBotSetup")}
              </span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* The calendar's day "+" asks for the composer through the same
          context; with no project in scope that becomes this project pick. */}
      {!project && compose?.open ? (
        <RequireProjectScope {...projectRequest} />
      ) : null}
    </>
  );
}
