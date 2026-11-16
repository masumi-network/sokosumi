import { SECTION_MARKDOWN_HEADINGS } from "@/app/projects/components/section-markdown-headings";
import {
  type DesignMdTypeToken,
  designMdTokens,
  splitFrontMatter,
} from "@/components/design-md/design-md-front-matter";
import Markdown from "@/components/markdown";

export interface DesignMdDocumentLabels {
  colors: string;
  typography: string;
  frontMatter: string;
}

const SUBHEADING_CLASS = "text-muted-foreground text-xs font-medium";
const FONT_WEIGHT = /^(?:[1-9]00|normal|bold)$/;
const FONT_FAMILY = /^[\w\s,'"-]+$/;

/**
 * A DESIGN.md as a designer reads it: the front matter's colours as swatches
 * and its type styles as samples, then the written guidance. The front
 * matter itself stays one click away, as written, so tokens this page does
 * not draw (spacing, components, …) and a block it cannot read are never
 * lost. A file without front matter renders as plain Markdown.
 */
export function DesignMdDocument({
  markdown,
  labels,
}: {
  markdown: string;
  labels: DesignMdDocumentLabels;
}) {
  const split = splitFrontMatter(markdown);
  const { colors, typography } = designMdTokens(split?.frontMatter ?? "");

  return (
    <div className="space-y-6">
      {colors.length > 0 ? (
        <section className="space-y-2" data-testid="design-md-colors">
          <h3 className={SUBHEADING_CLASS}>{labels.colors}</h3>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
            {colors.map(({ name, value, hex }) => (
              <li
                key={name}
                className="border-border flex min-w-0 items-center gap-3 rounded-lg border p-2"
              >
                <span
                  aria-hidden
                  className="border-border bg-muted size-8 shrink-0 rounded-md border"
                  style={hex ? { backgroundColor: hex } : undefined}
                />
                <span className="min-w-0">
                  <span className="block break-words text-sm">{name}</span>
                  <span className="text-muted-foreground block break-all font-mono text-xs">
                    {value}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {typography.length > 0 ? (
        <section className="space-y-2" data-testid="design-md-typography">
          <h3 className={SUBHEADING_CLASS}>{labels.typography}</h3>
          <ul className="divide-border divide-y">
            {typography.map((style) => (
              <TypeSample key={style.name} {...style} />
            ))}
          </ul>
        </section>
      ) : null}

      {split ? (
        <details data-testid="design-md-front-matter">
          <summary className={`${SUBHEADING_CLASS} cursor-pointer`}>
            {labels.frontMatter}
          </summary>
          <pre className="bg-muted app-scrollbar mt-2 overflow-x-auto rounded-lg p-3 font-mono text-xs">
            {split.frontMatter}
          </pre>
        </details>
      ) : null}

      <Markdown
        className="text-foreground"
        components={SECTION_MARKDOWN_HEADINGS}
      >
        {split ? split.body : markdown}
      </Markdown>
    </div>
  );
}

function TypeSample({ name, family, size, weight }: DesignMdTypeToken) {
  // Only values a browser reads as a family or a weight reach the style.
  const sampleFamily = family && FONT_FAMILY.test(family) ? family : null;
  const sampleWeight = weight && FONT_WEIGHT.test(weight) ? weight : null;
  const meta = [family, size, weight].filter(Boolean).join(" · ");

  return (
    <li className="flex min-w-0 items-center gap-4 py-2">
      <span
        aria-hidden
        className="w-14 shrink-0 text-2xl leading-none"
        style={{
          ...(sampleFamily && { fontFamily: sampleFamily }),
          ...(sampleWeight && { fontWeight: sampleWeight }),
        }}
      >
        Aa
      </span>
      <span className="min-w-0">
        <span className="block break-words text-sm">{name}</span>
        {meta ? (
          <span className="text-muted-foreground block break-words text-xs">
            {meta}
          </span>
        ) : null}
      </span>
    </li>
  );
}
