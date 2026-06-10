import { Building2, Coins, type LucideIcon } from "lucide-react";

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
    key: "creditGrants",
    href: "/admin/invoices",
    Icon: Coins,
  },
];
