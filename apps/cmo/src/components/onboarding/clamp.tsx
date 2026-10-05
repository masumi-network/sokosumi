"use client";

import { useLayoutEffect, useRef, useState } from "react";

interface ClampProps {
  /** Paragraphs, each cut to `lines` lines until opened. */
  items: { text: string; className?: string }[];
  lines: number;
}

/** Text cut to a few lines, with one "More" when any of it is cut. */
export function Clamp({ items, lines }: ClampProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    if (open || !ref.current) return;
    setOverflows(
      [...ref.current.querySelectorAll("p")].some(
        (paragraph) => paragraph.scrollHeight > paragraph.clientHeight + 1,
      ),
    );
  }, [open]);

  return (
    <div ref={ref} className="ob-clamp-group">
      {items.map(({ text, className }) => (
        <p
          key={text}
          className={`ob-clamp${open ? "" : " shut"}${className ? ` ${className}` : ""}`}
          style={{ WebkitLineClamp: lines }}
        >
          {text}
        </p>
      ))}
      {overflows || open ? (
        <button
          type="button"
          className="ob-more"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Less" : "More"}
        </button>
      ) : null}
    </div>
  );
}
