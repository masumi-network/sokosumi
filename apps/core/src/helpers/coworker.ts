import type { Prisma } from "@sokosumi/database";

import { mapVendor } from "@/helpers/vendor";
import { coworkerSchema } from "@/schemas/coworker.schema";

type CoworkerWithVendor = Prisma.CoworkerGetPayload<{
  include: typeof coworkerInclude;
}>;

export const coworkerInclude = {
  vendor: true,
} as const satisfies Prisma.CoworkerInclude;

export function mapCoworker(coworker: CoworkerWithVendor) {
  return coworkerSchema.parse({
    ...coworker,
    vendor: mapVendor(coworker.vendor),
  });
}
