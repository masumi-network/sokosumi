"use client";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { useNewTaskOpener } from "@/app/components/new-task-button.client";
import { ShareButton } from "@/components/share-button";
import { Button } from "@/components/ui/button";
import useIsClient from "@/hooks/use-is-client";

/**
 * Give a task: New task opens with this agent @-mentioned in the prompt. The
 * reader picks the coworker, reviews the cost and submits; nothing runs here.
 */
export function MarketplaceAgentActions({ agentId }: { agentId: string }) {
  const t = useTranslations("Components.Agents.ActionButtons");
  const openNewTask = useNewTaskOpener({ prompt: `@${agentId} ` });
  const isClient = useIsClient();
  const url = isClient
    ? new URL(`${window.location.origin}/agents/${agentId}`)
    : undefined;

  return (
    <>
      {openNewTask ? (
        <Button type="button" size="sm" onClick={openNewTask}>
          <Plus aria-hidden />
          {t("startTask")}
        </Button>
      ) : null}
      {url ? (
        <ShareButton url={url} className="hidden size-8 sm:inline-flex" />
      ) : null}
    </>
  );
}
