import type { ChatRoomPresence } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

/**
 * Ground the mark's ring, its crescent bite, and its hollow offline disc are
 * painted in. It has to match what actually sits behind the mark, or the ring
 * reads as a hole punched in whatever is underneath.
 *
 * These are the resting grounds. A row that paints an accent on hover or while
 * active still shows a slight mismatch, worst in dark mode where `--accent` is
 * 15% lightness against `--background` at 4%. That gap is not new, and it is
 * why the sidebar chip already reached for `border-sidebar` by hand before
 * these grounds existed. Matching an accent too needs each row to hand its own
 * painted colour down as a custom property, which is more than a 10px mark is
 * worth.
 */
const GROUND_CLASSES = {
  background: { ring: "border-background", fill: "bg-background" },
  sidebar: { ring: "border-sidebar", fill: "bg-sidebar" },
  popover: { ring: "border-popover", fill: "bg-popover" },
} as const;

/**
 * The crescent is the disc minus an offset copy of itself. The bite is painted
 * in the ground, the same colour as the ring around the mark, because that is
 * what makes the shape read as a crescent: any other colour turns it into a
 * disc with a dot on it. Any smaller offset reads as a dent rather than a bite;
 * any larger one thins the crescent past legibility at a 6px core, the
 * smallest this mark is drawn at.
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
        // `overflow-hidden` keeps the crescent's offset disc from eating into
        // the ring on the way past. It reaches well beyond the mark's edge by
        // design, so without the clip the ring thins wherever the bite crosses
        // it, and any fill other than the ground would show as a second circle.
        //
        // 10px with a 1px halo leaves an 8px core, sized for the 24 to 32px
        // avatars most surfaces use. Whole pixels only: a 1.5px halo blurs on
        // 1x displays. The 20px sidebar row goes down to `size-2` (6px core),
        // the inline marks next to text drop the halo (`border-0`), and the
        // 48px hover card raises the mark to `size-3`.
        "relative block size-2.5 overflow-hidden rounded-full border",
        ring,
        presence === "online" && "bg-presence-online",
        presence === "afk" && "bg-presence-afk",
        presence === "offline" && fill,
        className,
      )}
    >
      {presence === "afk" ? (
        <span
          className={cn("absolute inset-0 rounded-full", CRESCENT_BITE, fill)}
        />
      ) : null}
      {/* The offline stroke is the mark itself, so its width is fixed rather
          than inherited from the ring above. Callers override that ring
          (`border-0`) to tune the halo against their ground; inheriting here
          would erase the mark wherever the halo is `border-0`. 1px is the
          widest stroke that still leaves a hole in the 6px sidebar core; 2px
          turns that state into a solid grey dot.
          The disc behind it is filled with the ground rather than left clear,
          so the hollow state reads as a ring and not as a hole showing the
          avatar underneath. */}
      {presence === "offline" ? (
        <span className="border-presence-offline absolute inset-0 rounded-full border" />
      ) : null}
    </span>
  );
}
