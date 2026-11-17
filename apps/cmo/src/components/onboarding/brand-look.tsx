import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowUpRight } from "lucide-react";
import { joinNames } from "../../lib/names";

export type BrandVisual = NonNullable<CmoOverview["brandVisual"]>;

/** Whether hiring read anything of the brand's look from its site. */
export function hasLook(visual: BrandVisual | null | undefined): boolean {
  return Boolean(
    visual &&
      (visual.colors.length > 0 ||
        visual.fonts.length > 0 ||
        visual.designMdUrl),
  );
}

/** The brand's look from its DESIGN.md: colours, fonts and the file itself. */
export function BrandLook({ visual }: { visual: BrandVisual }) {
  return (
    <div className="ob-look">
      {visual.colors.length > 0 ? (
        <ul className="ob-look-colors" aria-label="Brand colours">
          {visual.colors.map((color) => (
            <li key={color}>
              <span style={{ background: color }} aria-hidden="true" />
              <code>{color}</code>
            </li>
          ))}
        </ul>
      ) : null}
      {visual.fonts.length > 0 ? (
        <p className="ob-look-fonts">
          {visual.fonts.length === 1 ? "Font" : "Fonts"}:{" "}
          {joinNames(visual.fonts)}
        </p>
      ) : null}
      {visual.designMdUrl ? (
        <a
          className="button button-secondary button-small"
          href={visual.designMdUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open DESIGN.md
          <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}
