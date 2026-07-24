import {
  Bot,
  BotMessageSquare,
  Building,
  Building2,
  Coins,
  LifeBuoy,
  ListTodo,
  type LucideIcon,
  Store,
  Users,
} from "lucide-react";

/** Operator-facing groups on the `/admin` overview hub. */
export type AdminSectionGroup =
  | "accounts"
  | "billing"
  | "catalog"
  | "operations";

export interface AdminSection {
  /** Stable key used for the React key and i18n lookups. */
  key: string;
  href: string;
  Icon: LucideIcon;
  group: AdminSectionGroup;
}

/**
 * Display order of admin groups on the overview hub. Sections are rendered
 * under these headings in this order.
 */
export const ADMIN_SECTION_GROUPS: AdminSectionGroup[] = [
  "accounts",
  "billing",
  "catalog",
  "operations",
];

/**
 * Single source of truth for the admin tools surfaced on the `/admin` overview
 * hub. Add a new admin tool here (plus its `App.Admin.Overview.Sections.<key>`
 * translations) to have it appear on the hub. If you introduce a new
 * `AdminSectionGroup` value, also append it to `ADMIN_SECTION_GROUPS` or the
 * section will not render.
 */
export const ADMIN_SECTIONS: AdminSection[] = [
  {
    key: "users",
    href: "/admin/users",
    Icon: Users,
    group: "accounts",
  },
  {
    key: "organizations",
    href: "/admin/organizations",
    Icon: Building,
    group: "accounts",
  },
  {
    key: "invoices",
    href: "/admin/invoices",
    Icon: Coins,
    group: "billing",
  },
  {
    key: "freeCredits",
    href: "/admin/free-credits",
    Icon: LifeBuoy,
    group: "billing",
  },
  {
    key: "enterpriseContracts",
    href: "/admin/enterprise-contracts",
    Icon: Building2,
    group: "billing",
  },
  {
    key: "agents",
    href: "/admin/agents",
    Icon: Bot,
    group: "catalog",
  },
  {
    key: "coworkers",
    href: "/admin/coworkers",
    Icon: BotMessageSquare,
    group: "catalog",
  },
  {
    key: "vendors",
    href: "/admin/vendors",
    Icon: Store,
    group: "catalog",
  },
  {
    key: "tasks",
    href: "/admin/tasks",
    Icon: ListTodo,
    group: "operations",
  },
];
