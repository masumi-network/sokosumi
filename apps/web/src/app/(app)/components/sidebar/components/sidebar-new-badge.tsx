import { useTranslations } from "next-intl";

/**
 * The label span's classes when it carries a "New" pill: one line where the
 * pill always shows and the name takes the rest, truncating only if a
 * translation is too long for the row.
 */
export const SIDEBAR_NEW_LABEL_CLASS = "flex min-w-0 items-center gap-x-1";

/** A nav row's name followed by a compact "New" pill. */
export function SidebarLabelWithNew({ label }: { label: string }) {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  return (
    <>
      <span className="min-w-0 truncate">{label}</span>
      <span
        aria-hidden
        className="bg-primary-quinary text-primary shrink-0 rounded-sm px-[3px] py-px text-[0.5rem] leading-none font-semibold tracking-tight uppercase"
      >
        {t("new")}
      </span>
    </>
  );
}
