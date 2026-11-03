/**
 * How a row a popover draws for itself answers the pointer, so it reads like a
 * `DropdownMenuItem` or `CommandItem` in the next menu over: the same fill,
 * radius and fade. Those primitives highlight through focus or selection, so
 * this is the one for a plain button, link or label in a `PopoverContent`.
 *
 * The primitives' fade follows `--default-transition-duration` by naming no
 * duration. This names it because `Button` brings its own `duration-150`, which
 * this has to replace.
 */
export const POPOVER_ROW_CLASS =
  "hover:bg-accent focus-visible:ring-ring rounded-sm outline-hidden transition-colors duration-(--default-transition-duration) focus-visible:ring-2";
