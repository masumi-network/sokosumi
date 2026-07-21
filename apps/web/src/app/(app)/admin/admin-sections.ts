import {
  Bot,
  BotMessageSquare,
  Building,
  Building2,
  Coins,
  LifeBuoy,
  ListTodo,
  type LucideIcon,
  Users,
} from "lucide-react";

export interface AdminSection {
  /** Stable key used for the React key and i18n lookups. */
  key: string;
  href: string;
  Icon: LucideIcon;
}

/**
 * Single source of truth for the admin tools surfaced on the `/admin` overview
 * hub. Add a new admin tool here (plus its `App.Admin.Overview.Sections.<key>`
 * translations) to have it appear on the hub.
 */
export const ADMIN_SECTIONS: AdminSection[] = [
  {
    key: "enterpriseContracts",
    href: "/admin/enterprise-contracts",
    Icon: Building2,
  },
  {
    key: "invoices",
    href: "/admin/invoices",
    Icon: Coins,
  },
  {
    key: "freeCredits",
    href: "/admin/free-credits",
    Icon: LifeBuoy,
  },
  {
    key: "organizations",
    href: "/admin/organizations",
    Icon: Building,
  },
  {
    key: "users",
    href: "/admin/users",
    Icon: Users,
  },
  {
    key: "tasks",
    href: "/admin/tasks",
    Icon: ListTodo,
  },
  {
    key: "coworkers",
    href: "/admin/coworkers",
    Icon: BotMessageSquare,
  },
  {
    key: "orchestrators",
    href: "/admin/orchestrators",
    Icon: Bot,
  },
];
