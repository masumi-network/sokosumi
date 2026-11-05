"use server";

import { err, ok } from "neverthrow";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import {
  type NewsletterDesignMdBrand,
  newsletterBrandFromDesignMd,
} from "@/app/newsletter/newsletter-brand-from-design-md";
import type { NewsletterDesignMdOption } from "@/app/newsletter/newsletter-design-md-picker";
import { fetchDesignMdMarkdown } from "@/components/design-md/design-md-edit-page-shared";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import { designMdService } from "@/lib/services/design-md.service";
import { projectService } from "@/lib/services/project.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface LoadNewsletterBrandFromDesignMdParameters
  extends AuthenticatedRequest {
  projectId: string;
  source: NewsletterDesignMdOption["source"];
}

const inputSchema = z.object({
  projectId: z.uuid(),
  source: z.enum(["workspace", "project"]),
});

async function resolveDesignMd(
  projectId: string,
  source: NewsletterDesignMdOption["source"],
): Promise<{ url: string; logoUrl: string | null } | null> {
  if (source === "project") {
    const project = await projectService.getProjectById(projectId);
    return project?.designMd
      ? { url: project.designMd.url, logoUrl: project.logo }
      : null;
  }
  const designMd = await designMdService.resolveEffectiveDesignMd();
  return designMd
    ? {
        url: designMd.url,
        logoUrl:
          designMd.owner.type === "organization" ? designMd.owner.logo : null,
      }
    : null;
}

/**
 * Newsletter Brand values from the chosen DESIGN.md. The URL is resolved here
 * from the source, never taken from the client.
 */
export const loadNewsletterBrandFromDesignMd = withSession<
  LoadNewsletterBrandFromDesignMdParameters,
  ActionResultDto<NewsletterDesignMdBrand, { message: string }>
>(async ({ projectId, source }) => {
  const t = await getTranslations("App.Projects.Newsletter.DesignPicker");
  const failed = toActionResult(err({ message: t("error") }));
  const parsed = inputSchema.safeParse({ projectId, source });
  if (!parsed.success) return failed;

  try {
    const designMd = await resolveDesignMd(
      parsed.data.projectId,
      parsed.data.source,
    );
    if (!designMd) return failed;
    const loaded = await fetchDesignMdMarkdown(designMd.url);
    if ("error" in loaded) return failed;
    return toActionResult(
      ok(
        newsletterBrandFromDesignMd(loaded.markdown, {
          logoUrl: designMd.logoUrl,
        }),
      ),
    );
  } catch {
    return failed;
  }
});
