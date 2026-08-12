"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  useContext,
  useMemo,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import { ensureCoworkerDirectRoomAction } from "@/app/chat/actions";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";

interface OpenCoworkerRoomApi {
  isPending: boolean;
  openCoworkerRoom: (coworkerId: string) => void;
  openingId: null | string;
}

const OpenCoworkerRoomContext = createContext<OpenCoworkerRoomApi | null>(null);

/**
 * Shared open-or-create DM flow for the welcome landing CTA and coworker strip.
 *
 * One provider per landing surface so both faces share pending state and cannot
 * race two concurrent room ensures.
 */
export function OpenCoworkerRoomProvider({
  children,
}: {
  children: ReactNode;
}) {
  const t = useTranslations("App.Chat.Landing");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [openingId, setOpeningId] = useState<null | string>(null);

  const value = useMemo<OpenCoworkerRoomApi>(() => {
    function openCoworkerRoom(coworkerId: string) {
      if (isPending) {
        return;
      }

      setOpeningId(coworkerId);
      startTransition(async () => {
        const result = await ensureCoworkerDirectRoomAction(coworkerId);

        if (!result.ok || !result.value) {
          toast.error(result.ok ? t("cta.error") : result.error.message);
          setOpeningId(null);
          return;
        }

        // Same order the rest of chat uses: tell the sidebar before navigating so
        // the new room is already in the list when the route renders.
        notifyOrganizationChatRoomsChanged(result.value);
        router.push(`/chat/rooms/${result.value.id}`);
        // Leave openingId set — the route change unmounts the caller, and
        // resetting here would flash the idle label on the CTA.
      });
    }

    return {
      isPending,
      openCoworkerRoom,
      openingId,
    };
  }, [isPending, openingId, router, t]);

  return (
    <OpenCoworkerRoomContext.Provider value={value}>
      {children}
    </OpenCoworkerRoomContext.Provider>
  );
}

export function useOpenCoworkerRoom(): OpenCoworkerRoomApi {
  const ctx = useContext(OpenCoworkerRoomContext);
  if (!ctx) {
    throw new Error(
      "useOpenCoworkerRoom must be used within OpenCoworkerRoomProvider",
    );
  }
  return ctx;
}
