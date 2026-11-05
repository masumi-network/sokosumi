"use client";

import { useState } from "react";

/** Three lines, then "more" for the rest. Short text shows no toggle. */
export function ExpandableText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 240;
  return (
    <span>
      <span className={long && !open ? "clamp" : undefined}>{text}</span>
      {long ? (
        <button type="button" className="more" onClick={() => setOpen(!open)}>
          {open ? "less" : "more"}
        </button>
      ) : null}
    </span>
  );
}
