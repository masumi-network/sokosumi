"use client";

import { Bot, ChevronDown, Loader2, PenLine, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { ensureSokoBotDirectRoomAction } from "@/app/chat/actions";
import {
  composeDraftKey,
  getComposeDraft,
  setComposeDraft,
} from "@/app/chat/utils/compose-draft-storage";
import { ProjectScopeMenu } from "@/app/components/project-scope/project-scope-menu";
import { openScopeCreate } from "@/app/components/project-scope/sidebar-project-scope-state";
import { useSocialCompose } from "@/app/social/components/social-compose-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
 * project connected; with none in scope the menu asks for one first and
 * reopens Social there with the composer up. Soko Bot does not need one: it
 * can ask in the conversation.
 */
export function SocialNewPostMenu({
  project,
  sokoBotId,
}: SocialNewPostMenuProps) {
  const t = useTranslations("App.Social.newPost");
  const router = useRouter();
  const compose = useSocialCompose();
  const [choosingProject, setChoosingProject] = useState(false);
  const [isOpeningChat, startOpeningChat] = useTransition();

  function writeManually() {
    if (project && compose) {
      compose.setOpen(true);
      return;
    }
    setChoosingProject(true);
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
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            aria-busy={isOpeningChat}
            disabled={isOpeningChat}
          >
            {isOpeningChat ? (
              <Loader2
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : (
              <Plus className="size-4" aria-hidden />
            )}
            {/* Icon only on a phone, so it fits on the tab row. */}
            <span className="max-sm:sr-only">{t("label")}</span>
            <ChevronDown className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuItem className="items-start" onSelect={writeManually}>
            <PenLine className="mt-0.5 size-4" aria-hidden />
            <span className="flex flex-col gap-0.5">
              <span>{t("manual")}</span>
              <span className="text-muted-foreground text-xs">
                {t("manualHint")}
              </span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem className="items-start" onSelect={postWithSokoBot}>
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

      <Dialog open={choosingProject} onOpenChange={setChoosingProject}>
        <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-sm">
          <DialogHeader className="p-4 pb-2">
            <DialogTitle>{t("chooseProjectTitle")}</DialogTitle>
            <DialogDescription>{t("chooseProjectBody")}</DialogDescription>
          </DialogHeader>
          <ProjectScopeMenu
            className="max-h-96"
            selectedProjectId={project?.id ?? null}
            onSelect={(projectId) => {
              if (!projectId) return;
              router.push(
                `/social?projectId=${encodeURIComponent(projectId)}&compose=new`,
              );
            }}
            onCreate={openScopeCreate}
            onDone={() => setChoosingProject(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
