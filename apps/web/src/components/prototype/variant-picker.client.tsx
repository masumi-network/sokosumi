"use client";

/**
 * PROTOTYPE harness: a floating switcher for `?variant=` UI prototypes.
 * Deliberately styled outside the design system so it is never judged as
 * part of the page. Hidden in production builds.
 */

import { parseAsString, useQueryState } from "nuqs";
import { useEffect } from "react";

import "./variant-picker.css";

export function usePrototypeVariant<T extends string>(
  variants: readonly T[],
): T {
  const [value] = useQueryState("variant", parseAsString);
  return variants.includes(value as T) ? (value as T) : variants[0]!;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function PrototypeVariantPicker<T extends string>({
  variants,
  labels,
}: {
  variants: readonly T[];
  labels: Record<T, string>;
}) {
  const current = usePrototypeVariant(variants);
  const [, setVariant] = useQueryState("variant", parseAsString);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (isTyping(event.target) || event.metaKey || event.ctrlKey) return;
      const index = variants.indexOf(current);
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        const step = event.key === "ArrowRight" ? 1 : -1;
        void setVariant(
          variants[(index + step + variants.length) % variants.length]!,
        );
      } else if (/^[1-9]$/.test(event.key)) {
        const next = variants[Number(event.key) - 1];
        if (next) void setVariant(next);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, variants, setVariant]);

  if (process.env.NODE_ENV === "production") return null;

  return (
    <nav aria-label="Variants" className="variant-picker">
      {variants.map((variant) => (
        <button
          key={variant}
          type="button"
          aria-current={variant === current ? "true" : undefined}
          onClick={() => void setVariant(variant)}
        >
          {labels[variant]}
        </button>
      ))}
    </nav>
  );
}
