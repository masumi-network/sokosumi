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
  return (
    <div className="space-y-2">
      <h2 className={GALLERY_SECTION_HEADLINE_CLASS}>
        {title}
        {count !== undefined ? (
          <span className="text-muted-foreground tabular-nums">
            {" · "}
            {count}
          </span>
        ) : null}
      </h2>
      {subtitle ? (
        <p className="text-muted-foreground text-sm md:text-base">{subtitle}</p>
      ) : null}
    </div>
  );
}
