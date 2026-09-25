import type { ComponentType } from "react";

/**
 * SOK-1202 variant harness. Throwaway: once a variant is chosen it is built
 * properly and this folder is deleted.
 *
 * `current` is today's navigation, kept as the baseline to compare against.
 */
export const SCOPE_VARIANTS = [
  { id: "current", label: "Current" },
  { id: "sidebar", label: "Sidebar scope" },
  { id: "header", label: "Header breadcrumb" },
  { id: "combined", label: "Combined switcher" },
  { id: "command", label: "Command-first" },
  { id: "hub", label: "Project hub" },
] as const;

export type ScopeVariantId = (typeof SCOPE_VARIANTS)[number]["id"];

export const SCOPE_VARIANT_PARAM = "variant";
export const SCOPE_VARIANT_STORAGE_KEY = "sokosumi.sok-1202.scope-variant";

/** Where a variant can render. Each mount point in the app chrome is one. */
export type ScopeSlotPlace =
  | "sidebar-header"
  | "sidebar-top"
  | "header-center"
  | "header-mobile"
  | "project-header";

/** What a mount point knows that the client cannot: server-only gates. */
export interface ScopeSlotProps {
  /** Social exists only for Social beta users. */
  socialBeta?: boolean;
}

/** The pieces one variant renders, keyed by mount point. */
export type ScopeSlots = Partial<
  Record<ScopeSlotPlace, ComponentType<ScopeSlotProps>>
>;

export function parseScopeVariant(
  value: string | null | undefined,
): ScopeVariantId | null {
  return SCOPE_VARIANTS.find((variant) => variant.id === value)?.id ?? null;
}
