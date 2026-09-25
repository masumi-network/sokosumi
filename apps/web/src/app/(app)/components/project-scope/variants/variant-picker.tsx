"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { isEditableKeyboardTarget } from "@/lib/utils/is-editable-keyboard-target";

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

/** Widgets whose arrow and digit keys already mean something. */
const KEY_OWNING_SURFACE =
  '[role="dialog"],[role="alertdialog"],[role="menu"],[role="menubar"],[role="listbox"],[role="combobox"],[role="tablist"],[role="radiogroup"],[role="slider"],[role="grid"],[role="tree"],[role="toolbar"]';

function isKeyTakenElsewhere(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.repeat) return true;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return true;
  }
  if (isEditableKeyboardTarget(event.target)) return true;
  return (
    event.target instanceof Element &&
    event.target.closest(KEY_OWNING_SURFACE) !== null
  );
}

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

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isKeyTakenElsewhere(event)) return;
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
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <nav className={styles.picker} aria-label="SOK-1202 variants">
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
