"use client";

import { Bot, ChevronDown, PenLine, Plus } from "lucide-react";
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
import { mobileCreateFabBottom } from "@/app/components/mobile-create-fab-geometry";
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
import useIsApplePlatform from "@/hooks/use-is-apple-platform";
import { SOKO_BOT_ROUTE } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";

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
  const isApple = useIsApplePlatform();
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
        {/* Disabled on the trigger, not the button: a loading button drops
            native `disabled`, and only the trigger's own flag stops Radix
            from opening the menu. */}
        <DropdownMenuTrigger asChild disabled={isOpeningChat}>
          <Button
            type="button"
            size="sm"
            className={cn(
              "fixed end-4 z-50 size-14 rounded-full shadow-lg md:static md:z-auto md:h-8 md:w-auto md:rounded-md md:shadow-none",
              mobileCreateFabBottom(isApple),
            )}
            loading={isOpeningChat}
          >
            <Plus className="size-6 md:size-4" aria-hidden />
            <span className="sr-only md:not-sr-only">{t("label")}</span>
            <ChevronDown className="hidden size-4 md:block" aria-hidden />
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
