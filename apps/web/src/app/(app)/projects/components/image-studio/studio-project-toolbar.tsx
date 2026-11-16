import { MessageSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactElement, ReactNode, Ref } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { STUDIO_COMPOSER_GUTTER_CLASS } from "./studio-classes";

/**
 * Hides a project toolbar label below `md`, leaving the icon.
 *
 * The label stays in the accessibility tree, so the button keeps its name.
 */
export const STUDIO_TOOLBAR_LABEL_CLASS = "max-md:sr-only";

/**
 * Names a project toolbar action on hover below `md`, where its label is
 * hidden. On wider screens the label is visible, so the tip stays hidden
 * rather than repeat it.
 */
export function StudioToolbarTip({
  children,
  label,
}: {
  children: ReactElement;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="md:hidden">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The selected project's actions above the gallery.
 *
 * Below `md` every action is an icon, so the row stays one line on a phone
 * and the gallery keeps its height.
 */
export function StudioProjectToolbar({
  assistantControls,
  assistantOpen,
  assistantTriggerRef,
  children,
  onAssistantToggle,
}: {
  assistantControls?: string;
  assistantOpen: boolean;
  assistantTriggerRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
  onAssistantToggle: () => void;
}) {
  const t = useTranslations("App.Studio");
  return (
    <div
      className={cn(
        "flex flex-wrap justify-end gap-2 pt-2",
        STUDIO_COMPOSER_GUTTER_CLASS,
      )}
    >
      {children}
      <StudioToolbarTip label={t("Assistant.title")}>
        <Button
          aria-controls={assistantControls}
          aria-expanded={assistantOpen}
          onClick={onAssistantToggle}
          ref={assistantTriggerRef}
          size="sm"
          type="button"
          variant="outline"
        >
          <MessageSquare aria-hidden />
          <span className={STUDIO_TOOLBAR_LABEL_CLASS}>
            {t("Assistant.title")}
          </span>
        </Button>
      </StudioToolbarTip>
    </div>
  );
}
