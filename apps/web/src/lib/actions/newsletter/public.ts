"use server";

import type { GetPublicNewslettersByPublicSlugIssuesResponse } from "@sokosumi/core-client";
import { err, ok } from "neverthrow";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { newsletterService } from "@/lib/services/newsletter.service";

const inputSchema = z.object({
  slug: z.string().min(1).max(300),
  cursor: z.uuid(),
});

export async function loadPublicNewsletterIssues(input: {
  slug: string;
  cursor: string;
}): Promise<
  ActionResultDto<
    GetPublicNewslettersByPublicSlugIssuesResponse,
    { message: string }
  >
> {
  const t = await getTranslations("PublicNewsletter");
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return toActionResult(err({ message: t("loadError") }));
  try {
    const response = await newsletterService.listPublicIssues(
      parsed.data.slug,
      {
        cursor: parsed.data.cursor,
      },
    );
    if (!response) return toActionResult(err({ message: t("unavailable") }));
    return toActionResult(ok(response));
  } catch {
    return toActionResult(err({ message: t("loadError") }));
  }
}
