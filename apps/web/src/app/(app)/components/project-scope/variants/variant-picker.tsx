"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect } from "react";

import {
  parseScopeVariant,
  SCOPE_VARIANT_PARAM,
  SCOPE_VARIANTS,
  type ScopeVariantId,
} from "./scope-variants";
import {
  storeScopeVariant,
  useScopeVariant,
  useScopeVariantOptedIn,
} from "./use-scope-variant";
import styles from "./variant-picker.module.css";

/**
 * SOK-1202 harness: flips between the scope switcher variants. The URL is the
 * source of truth, so every variant is a link; the tab remembers the choice
 * because app links drop the param. It shows only after a `?variant=` link.
 */
export function ScopeVariantPicker() {
  return useScopeVariantOptedIn() ? <Picker /> : null;
}

function Picker() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active = useScopeVariant();
  const fromUrl = parseScopeVariant(searchParams?.get(SCOPE_VARIANT_PARAM));

  // A shared `?variant=` link must stick after the first click away.
  useEffect(() => {
    if (fromUrl) storeScopeVariant(fromUrl);
  }, [fromUrl]);

  function choose(variant: ScopeVariantId) {
    storeScopeVariant(variant);
    const params = new URLSearchParams(searchParams?.toString());
    params.set(SCOPE_VARIANT_PARAM, variant);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  // Keys work only inside the picker: page-wide digits and arrows would be
  // single-key shortcuts (WCAG 2.1.4) and steal scrolling.
  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
      return;
    }
    const index = SCOPE_VARIANTS.findIndex(({ id }) => id === active);
    let next: number | null = null;
    if (event.key === "ArrowRight") next = index + 1;
    if (event.key === "ArrowLeft") next = index - 1;
    const digit = Number.parseInt(event.key, 10);
    if (digit >= 1 && digit <= SCOPE_VARIANTS.length) next = digit - 1;
    if (next === null) return;
    const count = SCOPE_VARIANTS.length;
    const variant = SCOPE_VARIANTS[(next + count) % count];
    if (!variant) return;
    event.preventDefault();
    choose(variant.id);
    event.currentTarget
      .querySelector<HTMLElement>(`[data-variant="${variant.id}"]`)
      ?.focus();
  }

  return (
    <nav
      className={styles.picker}
      aria-label="SOK-1202 variants"
      onKeyDown={onKeyDown}
    >
      {SCOPE_VARIANTS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          data-variant={id}
          aria-current={id === active ? "true" : undefined}
          onClick={() => choose(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
