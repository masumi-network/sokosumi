/**
 * The Task board's card shell, shared with the Soko Bots roster so both stay
 * one surface. Kept out of the client modules so Server Components can import
 * it.
 */
export const BOARD_CARD_CLASS =
  "bg-background border-border relative isolate rounded-lg border transition-[border-color,box-shadow,transform] hover:border-primary hover:shadow-sm press content-in";
