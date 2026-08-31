import prisma from "@/lib/db/prisma";

export interface SokoBotAvailability {
  disabled: boolean;
  disabledAt: Date | null;
  disabledReason: string | null;
}

/**
 * The administrator kill switch. Checked at every point a turn can begin, so
 * switching it off stops model calls whatever started them — chat, schedules,
 * ingest, coworker events or the lab.
 *
 * Read straight from the database on each check rather than cached: the whole
 * value of the switch is that it takes effect the moment it is thrown.
 */
export async function getSokoBotAvailability(): Promise<SokoBotAvailability> {
  const setting = await prisma.sokoBotSetting.findUnique({
    where: { id: "singleton" },
    select: { disabledAt: true, disabledReason: true },
  });
  return {
    disabled: setting?.disabledAt != null,
    disabledAt: setting?.disabledAt ?? null,
    disabledReason: setting?.disabledReason ?? null,
  };
}

export async function setSokoBotDisabled(input: {
  disabled: boolean;
  adminUserId: string;
  reason?: string | null;
}): Promise<SokoBotAvailability> {
  const disabledAt = input.disabled ? new Date() : null;
  const setting = await prisma.sokoBotSetting.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      disabledAt,
      disabledByUserId: input.disabled ? input.adminUserId : null,
      disabledReason: input.disabled ? (input.reason ?? null) : null,
    },
    update: {
      disabledAt,
      disabledByUserId: input.disabled ? input.adminUserId : null,
      disabledReason: input.disabled ? (input.reason ?? null) : null,
    },
    select: { disabledAt: true, disabledReason: true },
  });
  return {
    disabled: setting.disabledAt != null,
    disabledAt: setting.disabledAt,
    disabledReason: setting.disabledReason,
  };
}
