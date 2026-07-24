import {
  BookOpen,
  BotMessageSquare,
  KeyRound,
  ListTodo,
  type LucideIcon,
  Shield,
  Store,
} from "lucide-react";

export type DeveloperNavKey =
  | "oauthClients"
  | "apiKeys"
  | "coworkers"
  | "tasks"
  | "vendors"
  | "docs";

export interface DeveloperNavItem {
  key: DeveloperNavKey;
  href: string;
  translationKey: DeveloperNavKey;
  Icon: LucideIcon;
}

const BASE_DEVELOPER_NAV_ITEMS: DeveloperNavItem[] = [
  {
    key: "docs",
    href: "/developer/docs",
    translationKey: "docs",
    Icon: BookOpen,
  },
  {
    key: "oauthClients",
    href: "/developer/oauth-clients",
    translationKey: "oauthClients",
    Icon: Shield,
  },
  {
    key: "apiKeys",
    href: "/developer/api-keys",
    translationKey: "apiKeys",
    Icon: KeyRound,
  },
  {
    key: "coworkers",
    href: "/developer/coworkers",
    translationKey: "coworkers",
    Icon: BotMessageSquare,
  },
  {
    key: "tasks",
    href: "/developer/tasks",
    translationKey: "tasks",
    Icon: ListTodo,
  },
];

const VENDORS_NAV_ITEM: DeveloperNavItem = {
  key: "vendors",
  href: "/developer/vendors",
  translationKey: "vendors",
  Icon: Store,
};

export function getDeveloperNavItems({
  showVendors,
}: {
  showVendors: boolean;
}): DeveloperNavItem[] {
  if (!showVendors) {
    return BASE_DEVELOPER_NAV_ITEMS;
  }

  const apiKeysIndex = BASE_DEVELOPER_NAV_ITEMS.findIndex(
    (item) => item.key === "apiKeys",
  );
  if (apiKeysIndex === -1) {
    return [...BASE_DEVELOPER_NAV_ITEMS, VENDORS_NAV_ITEM];
  }

  const insertAt = apiKeysIndex + 1;
  return [
    ...BASE_DEVELOPER_NAV_ITEMS.slice(0, insertAt),
    VENDORS_NAV_ITEM,
    ...BASE_DEVELOPER_NAV_ITEMS.slice(insertAt),
  ];
}

export const DEVELOPER_DEFAULT_HREF = "/developer/oauth-clients";

export const DEVELOPER_TAB_REDIRECTS: Record<string, string> = {
  "oauth-clients": "/developer/oauth-clients",
  "api-keys": "/developer/api-keys",
  coworkers: "/developer/coworkers",
  tasks: "/developer/tasks",
  vendors: "/developer/vendors",
  docs: "/developer/docs",
  mcp: "/connections?tab=mcp",
};
