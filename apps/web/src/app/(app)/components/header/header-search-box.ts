/**
 * The header Search box, shared by the trigger and the loading fallback so
 * the row does not jump. Icon-only from `md`; from `lg` it shares free space
 * with the breadcrumbs, capped at 16rem and never narrower than 10rem so the
 * placeholder and shortcut always fit. `mr-3` keeps it off the workspace
 * switch.
 */
export const HEADER_SEARCH_BOX_CLASS =
  "hidden size-8 shrink-0 md:mr-3 md:flex lg:w-auto lg:min-w-40 lg:max-w-64 lg:flex-1";
