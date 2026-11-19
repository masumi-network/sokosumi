import type { SokoBotInboxMessage } from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import {
  type RhythmScopeBot,
  rhythmTaskScope,
} from "@/lib/soko-bot/rhythm-task-scope";

export function when(date: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function mailLine(
  message: SokoBotInboxMessage,
  timeZone: string,
): string {
  return `- ${when(message.receivedAt, timeZone)} · from ${message.from} · **${message.subject || "(no subject)"}** — ${message.snippet.replace(/\s+/g, " ").slice(0, 140)} [${message.provider}:${message.id}]`;
}

export async function ownerEmail(bot: RhythmScopeBot): Promise<string | null> {
  const ownerUserId = rhythmTaskScope(bot).ownerUserId;
  if (ownerUserId === null) return null;
  const user = await prisma.user.findUnique({
    where: { id: ownerUserId },
    select: { email: true },
  });
  return user?.email.toLowerCase() ?? null;
}
