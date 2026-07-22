import { resolveIpfsOrHttpUrl } from "@sokosumi/utils";

import type { Coworker } from "@/lib/clients/generated/core/types.gen";
import type { CoworkerDisplayPatchBody } from "@/lib/services/coworker-display.service";

export function toFieldValue(value: string | null | undefined): string {
  return value ?? "";
}

export function toImageDisplayValue(image: string | null | undefined): string {
  if (!image) {
    return "";
  }
  return resolveIpfsOrHttpUrl(image);
}

export function normalizeOptionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function buildCoworkerDisplayPatchBody(
  coworker: Coworker,
  values: {
    name: string;
    caption: string;
    description: string;
  },
): CoworkerDisplayPatchBody | undefined {
  const patchBody: CoworkerDisplayPatchBody = {};

  const nextName = values.name.trim();
  if (nextName !== coworker.name) {
    patchBody.name = nextName;
  }

  const nextCaption = normalizeOptionalText(values.caption);
  if (nextCaption !== (coworker.caption ?? null)) {
    patchBody.caption = nextCaption;
  }

  const nextDescription = normalizeOptionalText(values.description);
  if (nextDescription !== (coworker.description ?? null)) {
    patchBody.description = nextDescription;
  }

  return Object.keys(patchBody).length > 0 ? patchBody : undefined;
}
