import type { ChatRoomPresence } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

/**
 * Ground the mark's ring and its hollow offline disc are painted in. It has to
 * match what actually sits behind the mark, or the ring reads as a hole punched
 * in whatever is underneath.
 *
 * These are the resting grounds. A row that paints an accent on hover or while
 * active still shows a slight mismatch, worst in dark mode where `--accent` is
 * 15% lightness against `--background` at 4%. That gap is not new, and it is
 * why the sidebar chip already reached for `border-sidebar` by hand before
 * these grounds existed. Matching an accent too needs each row to hand its own
 * painted colour down as a custom property, which is more than a 12px mark is
 * worth.
 */
const GROUND_CLASSES = {
  background: { ring: "border-background", fill: "bg-background" },
  sidebar: { ring: "border-sidebar", fill: "bg-sidebar" },
  popover: { ring: "border-popover", fill: "bg-popover" },
} as const;

/**
 * The crescent is the disc minus an offset copy of itself, filled with a bright
 * grey rather than cut through to the surface. Any smaller offset reads as a
 * dent rather than a bite; any larger one thins the crescent past legibility at
 * an 8px core.
 */
const CRESCENT_BITE = "translate-x-[32%] -translate-y-[32%] scale-[0.72]";

interface PresenceDotProps {
  presence: ChatRoomPresence;
  /** Positioning and size classes. Callers pass their own absolute offsets. */
  className?: string;
  ground?: keyof typeof GROUND_CLASSES;
  /**
   * Availability as a native tooltip, for sighted pointer users on surfaces
   * with no room for a visible label. The mark is `aria-hidden`, so this never
   * reaches assistive technology and never becomes an accessible name.
   */
  title?: string;
}

/**
 * Availability mark. Each state has its own silhouette (filled disc, crescent,
 * empty ring) so the three stay apart without colour.
 *
 * The mark is always decorative: `aria-hidden`, and it contributes no text to
 * any accessible name. Several surfaces here sit under an ancestor that
 * overrides descendant text, an explicit `aria-label` on a parent button or an
 * `aria-hidden` one, so hidden text in here would reach assistive technology on
 * some surfaces and vanish on others, with nothing at the call site to say
 * which. Every surface that states availability does so on its own terms, in
 * visible text, in `LiveMemberPresenceText`, or inside its own label. The
 * `title` is the one thing the mark carries, and it is a pointer affordance
 * only.
 */
export function PresenceDot({
  presence,
  className,
  ground = "background",
  title,
}: PresenceDotProps) {
  const { ring, fill } = GROUND_CLASSES[ground];

  return (
    <span
      aria-hidden="true"
      title={title}
      className={cn(
        // `overflow-hidden` clips the crescent's offset disc to the padding
        // box. Without it that disc escapes the mark and reads as a second
        // circle, which stayed invisible only while it was painted in the
        // surface colour.
        "relative block size-3 overflow-hidden rounded-full border-2",
        ring,
        presence === "online" && "bg-presence-online",
        presence === "afk" && "bg-presence-afk",
        presence === "offline" && fill,
        className,
      )}
    >
      {presence === "afk" ? (
        <span
          className={cn(
            "bg-presence-afk-core absolute inset-0 rounded-full",
            CRESCENT_BITE,
          )}
        />
      ) : null}
      {/* The offline stroke is the mark itself, so its width is fixed rather
          than inherited from the ring above. Callers override that ring
          (`border-[1.5px]`, `border-0`) to tune the halo against their ground;
          inheriting here would erase the mark wherever the halo is `border-0`.
          The disc behind it is filled with the ground rather than left clear,
          so the hollow state reads as a ring and not as a hole showing the
          avatar underneath. */}
      {presence === "offline" ? (
        <span className="border-presence-offline absolute inset-0 rounded-full border-2" />
      ) : null}
    </span>
  );
}
