"use client";

import { useEffect } from "react";
import {
  ACTIVITY_VARIANT_LABELS,
  ACTIVITY_VARIANTS,
} from "./activity-variant-feed";
import styles from "./activity-variant-picker.module.css";

const OPTIONS = [
  { value: "current", label: "Current" },
  ...ACTIVITY_VARIANTS.map((value) => ({
    value,
    label: ACTIVITY_VARIANT_LABELS[value],
  })),
] as const;

function setVariantParam(value: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("variant", value);
  // Native history keeps the switch client-only; Next syncs useSearchParams.
  window.history.replaceState(null, "", url);
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function ActivityVariantPicker({ active }: { active: string }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }
      const index = OPTIONS.findIndex((option) => option.value === active);
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        const step = event.key === "ArrowRight" ? 1 : -1;
        const next = OPTIONS[(index + step + OPTIONS.length) % OPTIONS.length];
        if (next) {
          event.preventDefault();
          setVariantParam(next.value);
        }
        return;
      }
      const numbered = OPTIONS[Number(event.key) - 1];
      if (numbered) {
        event.preventDefault();
        setVariantParam(numbered.value);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active]);

  return (
    <nav className={styles.picker} aria-label="Variants">
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          data-variant={option.value}
          aria-current={option.value === active ? "true" : undefined}
          onClick={() => setVariantParam(option.value)}
        >
          {option.label}
        </button>
      ))}
    </nav>
  );
}
