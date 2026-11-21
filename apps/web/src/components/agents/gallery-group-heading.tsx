import { useFormatter } from "next-intl";

import { GALLERY_SECTION_HEADLINE_CLASS } from "@/components/agents/gallery-page-classes";

/** A result group's heading on the Agents page; `count` shows while searching. */
export function GalleryGroupHeading({
  title,
  subtitle,
  count,
}: {
  title: string;
  subtitle?: string;
  count?: number | undefined;
}) {
  const format = useFormatter();
  return (
    <div className="space-y-2">
      <h2 className={GALLERY_SECTION_HEADLINE_CLASS}>
        {title}
        {count !== undefined ? (
          <span className="text-muted-foreground tabular-nums">
            {" · "}
            {format.number(count)}
          </span>
        ) : null}
      </h2>
      {subtitle ? (
        <p className="text-muted-foreground text-sm md:text-base">{subtitle}</p>
      ) : null}
    </div>
  );
}

/**
 * Says how a search changed a result group. Stays mounted (empty when there is
 * nothing to say) so screen readers hear each new count while focus stays in
 * the search field.
 */
export function GalleryResultsStatus({ message }: { message: string }) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}
