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

/** True when a markdown link label is owned by the Context section UI. */
export function isTaskContextAttachmentLabel(label: string): boolean {
  return TASK_CONTEXT_ATTACHMENT_LABELS.has(label);
}

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
  // Stale or foreign DESIGN.md cannot round-trip as `custom` — web only
  // accepts caller ad-hoc URLs and Core 422s anything else. Prefer the live
  // project/workspace brand so a no-op edit save still succeeds.
  if (options.projectDesignMdUrl) {
    return "project";
  }
  if (options.workspaceDesignMdUrl) {
    return "default";
  }
  // No live brand to remap onto — keep custom with the stored URL so the chip
  // stays on; Core update may grandfather the existing attachment.
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

export interface TaskContextAttachmentFlags {
  brand: {
    enabled: boolean;
    source?: "project" | "default" | "custom";
    custom?: { url: string } | null;
  };
  briefingEnabled: boolean;
  contextMdEnabled: boolean;
}

export interface TaskContextAttachmentAvailability {
  projectDesignMdUrl?: string | null;
  workspaceDesignMdUrl?: string | null;
  projectBriefingUrl?: string | null;
  projectContextMdUrl?: string | null;
}

export function taskContextSelectionAttachesAnything(
  selection: TaskContextAttachmentFlags,
): boolean {
  return (
    selection.brand.enabled ||
    selection.briefingEnabled ||
    selection.contextMdEnabled
  );
}

export function taskContextSelectionResolvesAnything(
  selection: TaskContextAttachmentFlags,
  availability: TaskContextAttachmentAvailability,
): boolean {
  if (selection.brand.enabled) {
    const source = selection.brand.source ?? "project";
    if (source === "custom") {
      if (selection.brand.custom?.url) {
        return true;
      }
    } else if (source === "project") {
      if (
        availability.projectDesignMdUrl ||
        availability.workspaceDesignMdUrl
      ) {
        return true;
      }
    } else if (availability.workspaceDesignMdUrl) {
      return true;
    }
  }

  if (selection.briefingEnabled && availability.projectBriefingUrl) {
    return true;
  }
  if (selection.contextMdEnabled && availability.projectContextMdUrl) {
    return true;
  }
  return false;
}
