"use client";

/**
 * PROTOTYPE harness: a floating switcher for `?variant=` UI prototypes.
 * Deliberately styled outside the design system so it is never judged as
 * part of the page. Hidden in production builds.
 */

import { parseAsString, useQueryState } from "nuqs";
import { useEffect } from "react";

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
    <nav
      aria-label="Variants"
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        translate: "-50% 0",
        zIndex: 2147483647,
        display: "flex",
        gap: 2,
        padding: 4,
        borderRadius: 999,
        background: "rgb(20 20 20 / 0.9)",
        boxShadow:
          "inset 0 0 0 1px rgb(255 255 255 / 0.1), 0 8px 24px rgb(0 0 0 / 0.25)",
        font: '13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        userSelect: "none",
      }}
    >
      {variants.map((variant) => (
        <button
          key={variant}
          type="button"
          aria-current={variant === current ? "true" : undefined}
          onClick={() => void setVariant(variant)}
          style={{
            padding: "7px 14px",
            border: 0,
            borderRadius: 999,
            cursor: "pointer",
            background:
              variant === current ? "rgb(255 255 255 / 0.14)" : "transparent",
            color:
              variant === current
                ? "rgb(255 255 255)"
                : "rgb(255 255 255 / 0.6)",
          }}
        >
          {labels[variant]}
        </button>
      ))}
    </nav>
  );
}
