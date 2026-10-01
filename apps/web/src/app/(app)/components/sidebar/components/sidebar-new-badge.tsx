import { useTranslations } from "next-intl";

/** "New" pill after a sidebar label; hidden on the collapsed rail. */
export function SidebarNewBadge() {
  const t = useTranslations("App.Sidebar.Content.MenuItems");
  return (
    <span
      aria-hidden
      className="bg-primary-quinary text-primary ml-auto shrink-0 rounded-sm px-1.5 py-0.5 text-[0.625rem] leading-none font-semibold tracking-wide uppercase group-data-[collapsible=icon]:hidden"
    >
      {t("new")}
    </span>
  );
}
