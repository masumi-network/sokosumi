import {
  BookOpen,
  Bot,
  Building2,
  Cable,
  CircleHelp,
  Landmark,
  ListChecks,
  ReceiptText,
  ScrollText,
  Shield,
  User as UserIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";
import { MemberRole } from "@/lib/clients/generated/core";
import { LEGAL_URLS } from "@/lib/constants/legal-urls";

export interface HelpLinkItem {
  url: string;
  translationKey: "documentation" | "support";
  icon?: ComponentType<{ "aria-hidden"?: boolean; className?: string }>;
}

export interface LegalLinkItem {
  url: string;
  translationKey:
    | "termsOfService"
    | "privacyPolicy"
    | "imprint"
    | "acceptableUse"
    | "serviceplanAiCoworker";
  icon?: ComponentType<{ "aria-hidden"?: boolean; className?: string }>;
}

export interface AccountNavItem {
  key: string;
  href: string;
  translationKey: string;
  Icon: ComponentType<{ "aria-hidden"?: boolean; className?: string }>;
}

export const HELP_LINKS: HelpLinkItem[] = [
  {
    url: "https://www.masumi.network/dev/sokosumi/documentation",
    translationKey: "documentation",
    icon: BookOpen,
  },
  {
    url: "mailto:info@sokosumi.com",
    translationKey: "support",
    icon: CircleHelp,
  },
];

export const LEGAL_LINKS: LegalLinkItem[] = [
  {
    url: LEGAL_URLS.SERVICEPLAN_AI_COWORKER,
    translationKey: "serviceplanAiCoworker",
    icon: Bot,
  },
  {
    url: LEGAL_URLS.TERMS_OF_SERVICE,
    translationKey: "termsOfService",
    icon: ScrollText,
  },
  {
    url: LEGAL_URLS.PRIVACY_POLICY,
    translationKey: "privacyPolicy",
    icon: Shield,
  },
  {
    url: LEGAL_URLS.IMPRINT,
    translationKey: "imprint",
    icon: Landmark,
  },
  {
    url: LEGAL_URLS.ACCEPTABLE_USE,
    translationKey: "acceptableUse",
    icon: ListChecks,
  },
];

interface GetAccountNavItemsArgs {
  activeOrganizationId: string | null;
  members: MemberWithOrganization[];
}

export function getAccountNavItems({
  activeOrganizationId,
  members,
}: GetAccountNavItemsArgs): AccountNavItem[] {
  const activeOrganizationMember = activeOrganizationId
    ? members.find((member) => member.organizationId === activeOrganizationId)
    : null;
  const canViewBilling =
    !activeOrganizationId ||
    activeOrganizationMember?.role === MemberRole.OWNER ||
    activeOrganizationMember?.role === MemberRole.ADMIN;
  const items: AccountNavItem[] = [
    {
      key: "account",
      href: "/account",
      translationKey: "account",
      Icon: UserIcon,
    },
  ];

  if (activeOrganizationMember) {
    items.push({
      key: "organization",
      href: "/organization",
      translationKey: "organization",
      Icon: Building2,
    });
  }

  if (canViewBilling) {
    items.push({
      key: "billing",
      href: "/billing",
      translationKey: "billing",
      Icon: ReceiptText,
    });
  }

  items.push({
    key: "connections",
    href: "/connections",
    translationKey: "connections",
    Icon: Cable,
  });

  return items;
}
