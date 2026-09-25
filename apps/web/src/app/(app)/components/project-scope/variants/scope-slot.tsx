"use client";

import { type ReactNode, Suspense } from "react";

import type {
  ScopeSlotPlace,
  ScopeSlotProps,
  ScopeSlots,
  ScopeVariantId,
} from "./scope-variants";
import {
  useReplacesOldProjectNavigation,
  useScopeVariant,
} from "./use-scope-variant";
import { combinedSlots } from "./variant-combined";
import { commandSlots } from "./variant-command";
import { headerSlots } from "./variant-header";
import { hubSlots } from "./variant-hub";
import { sidebarSlots } from "./variant-sidebar";

const SLOTS: Record<ScopeVariantId, ScopeSlots> = {
  current: {},
  sidebar: sidebarSlots,
  header: headerSlots,
  combined: combinedSlots,
  command: commandSlots,
  hub: hubSlots,
};

interface ScopeSlotMountProps extends ScopeSlotProps {
  place: ScopeSlotPlace;
}

function ActiveSlot({ place, ...props }: ScopeSlotMountProps) {
  const Slot = SLOTS[useScopeVariant()][place];
  return Slot ? <Slot {...props} /> : null;
}

/** A mount point in the app chrome. Renders the active variant's piece. */
export function ScopeSlot(props: ScopeSlotMountProps) {
  return (
    <Suspense fallback={null}>
      <ActiveSlot {...props} />
    </Suspense>
  );
}

function OldWay({ children }: { children: ReactNode }) {
  return useReplacesOldProjectNavigation() ? null : children;
}

/**
 * Today's project navigation. Every new variant replaces it, so it renders
 * only on the `current` baseline.
 */
export function ScopeOldWay({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={children}>
      <OldWay>{children}</OldWay>
    </Suspense>
  );
}
