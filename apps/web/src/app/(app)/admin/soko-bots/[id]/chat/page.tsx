import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminSokoBotChatView } from "@/components/admin/soko-bots/admin-soko-bot-chat-view.client";
import { AdminSokoBotHeader } from "@/components/admin/soko-bots/admin-soko-bot-header";
import { adminSokoBotService } from "@/lib/services/admin-soko-bot.service";

export const instant = false;

export const metadata: Metadata = {
  title: "Soko Bot · Chat",
  description: "Read-only view of a Soko Bot's chats",
};

interface AdminSokoBotChatPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ room?: string }>;
}

export default async function AdminSokoBotChatPage({
  params,
  searchParams,
}: AdminSokoBotChatPageProps) {
  const [{ id }, { room }] = await Promise.all([params, searchParams]);
  const [bot, rooms] = await Promise.all([
    adminSokoBotService.get(id),
    adminSokoBotService.listChats(id).catch(() => []),
  ]);
  if (!bot) notFound();

  const selected =
    rooms.find((candidate) => candidate.id === room) ??
    rooms.find((candidate) => candidate.isOwnerRoom) ??
    rooms[0];
  const firstPage = selected
    ? await adminSokoBotService.listChatMessages(bot.id, selected.id)
    : null;

  return (
    <div className="min-h-full w-full">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-2">
        <AdminSokoBotHeader bot={bot} active="chat" />
        <AdminSokoBotChatView
          key={selected?.id ?? "none"}
          sokoBotId={bot.id}
          botName={bot.name}
          rooms={rooms}
          selectedRoomId={selected?.id ?? null}
          initialMessages={firstPage?.messages ?? []}
          initialCursor={firstPage?.nextCursor ?? null}
        />
      </div>
    </div>
  );
}
