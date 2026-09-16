import { DESIGN_MD_ATTACHMENT_LABEL } from "./design-md-attachment.js";
import {
  findMarkdownLinks,
  replaceMarkdownLinks,
  unescapeMarkdownLinkUrl,
} from "./markdown-links.js";

export const PROJECT_BRIEFING_ATTACHMENT_LABEL = "BRIEFING.md";
export const PROJECT_CONTEXT_MD_ATTACHMENT_LABEL = "CONTEXT.md";

/** Labels of the context files Sokosumi prepends to task descriptions. */
const TASK_CONTEXT_ATTACHMENT_LABELS: ReadonlySet<string> = new Set([
  DESIGN_MD_ATTACHMENT_LABEL,
  PROJECT_BRIEFING_ATTACHMENT_LABEL,
  PROJECT_CONTEXT_MD_ATTACHMENT_LABEL,
]);

export interface TaskContextSelectionSnapshot {
  brandEnabled: boolean;
  brandSource: "project" | "default" | "custom";
  brandUrl: string | null;
  briefingEnabled: boolean;
  memoryEnabled: boolean;
}

export interface ParseTaskContextFromDescriptionOptions {
  projectDesignMdUrl?: string | null;
  workspaceDesignMdUrl?: string | null;
  /** Pathname prefix for ad-hoc DESIGN.md blobs, e.g. `design-md/adhoc/{userId}/`. */
  adHocPathPrefix?: string | null;
}

function isUrlUnderPathPrefix(url: string, prefix: string): boolean {
  const normalized = prefix.startsWith("/") ? prefix.slice(1) : prefix;
  try {
    return decodeURIComponent(new URL(url).pathname).startsWith(
      `/${normalized}`,
    );
  } catch {
    return false;
  }
}

function resolveBrandSource(
  brandUrl: string,
  options: ParseTaskContextFromDescriptionOptions,
): "project" | "default" | "custom" {
  if (options.projectDesignMdUrl && brandUrl === options.projectDesignMdUrl) {
    return "project";
  }
  if (
    options.workspaceDesignMdUrl &&
    brandUrl === options.workspaceDesignMdUrl
  ) {
    return "default";
  }
  if (
    options.adHocPathPrefix &&
    isUrlUnderPathPrefix(brandUrl, options.adHocPathPrefix)
  ) {
    return "custom";
  }
  // Unknown DESIGN.md URL still reflects stored state as custom rather than
  // inventing a project/workspace default that would rewrite the link on save.
  return "custom";
}

/**
 * Strips DESIGN.md, BRIEFING.md and CONTEXT.md attachment links so the
 * remaining markdown is what the user actually wrote — for naming, summaries
 * and prompts.
 */
export function removeTaskContextAttachmentLinks(markdown: string): string {
  const withoutLinks = replaceMarkdownLinks(markdown, (match) =>
    TASK_CONTEXT_ATTACHMENT_LABELS.has(match.text) ? "" : match.match,
  );

  return withoutLinks.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Inverse of create-time Context prepend: read which Context files are
 * attached, classify the DESIGN.md brand source, and return the user prose
 * without those links. Missing links stay off — do not invent create defaults.
 */
export function parseTaskContextFromDescription(
  markdown: string,
  options: ParseTaskContextFromDescriptionOptions = {},
): {
  body: string;
  selection: TaskContextSelectionSnapshot;
} {
  let brandUrl: string | null = null;
  let briefingEnabled = false;
  let memoryEnabled = false;

  for (const link of findMarkdownLinks(markdown)) {
    if (!TASK_CONTEXT_ATTACHMENT_LABELS.has(link.text)) {
      continue;
    }
    const url = unescapeMarkdownLinkUrl(link.rawUrl);
    if (link.text === DESIGN_MD_ATTACHMENT_LABEL && !brandUrl) {
      brandUrl = url;
    } else if (link.text === PROJECT_BRIEFING_ATTACHMENT_LABEL) {
      briefingEnabled = true;
    } else if (link.text === PROJECT_CONTEXT_MD_ATTACHMENT_LABEL) {
      memoryEnabled = true;
    }
  }

  if (brandUrl !== null) {
    return {
      body: removeTaskContextAttachmentLinks(markdown),
      selection: {
        brandEnabled: true,
        brandSource: resolveBrandSource(brandUrl, options),
        brandUrl,
        briefingEnabled,
        memoryEnabled,
      },
    };
  }

  return {
    body: removeTaskContextAttachmentLinks(markdown),
    selection: {
      brandEnabled: false,
      brandSource: options.projectDesignMdUrl ? "project" : "default",
      brandUrl: null,
      briefingEnabled,
      memoryEnabled,
    },
  };
}
