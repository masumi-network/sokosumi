import { databaseNow } from "@/lib/db/database-now";
import prisma from "@/lib/db/prisma";
import { nextStandupAt } from "@/services/team-standup.service";

const DEFAULTS = {
  enabled: false,
  roomId: null,
  timeOfDay: "09:00",
  weekdays: [1, 2, 3, 4, 5],
  timezone: "Europe/Berlin",
  nextRunAt: null,
  lastRunAt: null,
};

function toDto(standup: {
  enabled: boolean;
  roomId: string | null;
  timeOfDay: string;
  weekdays: number[];
  timezone: string;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
}) {
  return {
    enabled: standup.enabled,
    roomId: standup.roomId,
    timeOfDay: standup.timeOfDay,
    weekdays: standup.weekdays,
    timezone: standup.timezone,
    nextRunAt: standup.nextRunAt?.toISOString() ?? null,
    lastRunAt: standup.lastRunAt?.toISOString() ?? null,
  };
}

export async function getTeamStandup(organizationId: string) {
  const standup = await prisma.teamStandup.findUnique({
    where: { organizationId },
  });
  return toDto(standup ?? DEFAULTS);
}

/** An admin's change; the next slot is worked out from the new time. */
export async function updateTeamStandup(
  organizationId: string,
  input: {
    enabled?: boolean;
    timeOfDay?: string;
    weekdays?: number[];
    timezone?: string;
  },
) {
  if (input.timezone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timezone });
    } catch {
      throw new TeamStandupSettingsError("Unknown time zone");
    }
  }
  const current = await prisma.teamStandup.findUnique({
    where: { organizationId },
  });
  const next = {
    enabled: input.enabled ?? current?.enabled ?? DEFAULTS.enabled,
    timeOfDay: input.timeOfDay ?? current?.timeOfDay ?? DEFAULTS.timeOfDay,
    weekdays: [
      ...new Set(input.weekdays ?? current?.weekdays ?? DEFAULTS.weekdays),
    ].sort(),
    timezone: input.timezone ?? current?.timezone ?? DEFAULTS.timezone,
  };
  const nextRunAt = next.enabled
    ? nextStandupAt(next, await databaseNow())
    : null;
  const standup = await prisma.teamStandup.upsert({
    where: { organizationId },
    create: { organizationId, ...next, nextRunAt },
    update: { ...next, nextRunAt },
  });
  return toDto(standup);
}

export class TeamStandupSettingsError extends Error {}
