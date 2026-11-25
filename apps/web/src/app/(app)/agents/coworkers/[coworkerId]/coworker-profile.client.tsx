"use client";

import type { Coworker } from "@sokosumi/core-client";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { StartChatButton } from "@/app/chat/components/landing/start-chat-button.client";
import { OpenCoworkerRoomProvider } from "@/app/chat/components/landing/use-open-coworker-room";
import { coworkerCanChat } from "@/app/chat/utils/coworker-utils";
import { useNewTaskOpener } from "@/app/components/new-task-button.client";
import { CoworkerAvatar } from "@/components/agents/coworker-avatar";
import {
  OfferCard,
  OfferDetailDialog,
  type OutputKind,
} from "@/components/agents/offer-card";
import { Button } from "@/components/ui/button";

type Offer = NonNullable<NonNullable<Coworker["metadata"]>["offers"]>[number];

/** Give a task and, when the coworker chats, Chat. */
export function CoworkerActions({ coworker }: { coworker: Coworker }) {
  const t = useTranslations("App.Agents.Directory");
  const openNewTask = useNewTaskOpener({ assigneeId: coworker.id });
  return (
    <OpenCoworkerRoomProvider>
      {openNewTask ? (
        <Button type="button" size="sm" onClick={openNewTask}>
          <Plus aria-hidden className="size-4" />
          {t("giveTask")}
        </Button>
      ) : null}
      {coworkerCanChat(coworker) ? (
        <StartChatButton
          coworkerId={coworker.id}
          coworkerName={coworker.name}
          variant="outline"
          className="h-8 gap-1.5 px-3"
        />
      ) : null}
    </OpenCoworkerRoomProvider>
  );
}

/** The coworker's ready-to-run tasks; one opens its example and starts it. */
export function CoworkerOffers({ coworker }: { coworker: Coworker }) {
  const t = useTranslations("App.Agents.CoworkerGallerySection");
  const [selected, setSelected] = useState<Offer | null>(null);
  const openNewTask = useNewTaskOpener({
    assigneeId: coworker.id,
    prompt: selected?.prompt ?? null,
  });
  const offers = coworker.metadata?.offers ?? [];
  const typeLabel = (type: OutputKind) => t(`outputTypes.${type}`);
  const avatar = (className: string) => (
    <CoworkerAvatar coworker={coworker} className={className} sizes="44px" />
  );

  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {offers.map((offer) => (
          <OfferCard
            key={offer.title}
            offer={offer}
            typeLabel={typeLabel}
            onClick={() => setSelected(offer)}
            coworkerName={coworker.name}
            coworkerAvatar={avatar("size-6")}
          />
        ))}
      </div>
      <OfferDetailDialog
        item={
          selected
            ? {
                offer: selected,
                coworkerName: coworker.name,
                coworkerCaption: coworker.caption ?? undefined,
                vendor: coworker.vendor,
                coworkerAvatar: avatar("size-11"),
              }
            : null
        }
        onClose={() => setSelected(null)}
        onStart={
          openNewTask
            ? () => {
                openNewTask();
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
        typeLabel={typeLabel}
      />
    </>
  );
}
