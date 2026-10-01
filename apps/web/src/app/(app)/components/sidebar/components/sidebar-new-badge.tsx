import { useTranslations } from "next-intl";

/**
 * The label span's classes when it carries a "New" pill: one 20px wrapping
 * line, clipped, so the pill wraps out of sight whenever the full name does
 * not leave room for it. The name always wins.
 */
export const SIDEBAR_NEW_LABEL_CLASS =
  "flex h-5 flex-wrap items-center gap-x-1.5 overflow-hidden";

/** A nav row's name followed by a compact "New" pill. */
export function SidebarLabelWithNew({ label }: { label: string }) {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  return (
    <>
      <span className="max-w-full overflow-hidden whitespace-nowrap">
        {label}
      </span>
      <span
        aria-hidden
        className="bg-primary-quinary text-primary shrink-0 rounded-sm px-1 py-px text-[0.5625rem] leading-none font-semibold tracking-tight uppercase"
      >
        {t("new")}
      </span>
    </>
  );
}
