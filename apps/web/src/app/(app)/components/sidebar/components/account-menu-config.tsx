import { MemberRole } from "@sokosumi/utils";
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
    url: "https://docs.sokosumi.com/documentation",
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
    url: "https://www.house-of-communication.com/de/en/brands/plan-net/landingpages/agentic-services/legal-ai-coworkers.html",
    translationKey: "serviceplanAiCoworker",
    icon: Bot,
  },
  {
    url: "https://www.sokosumi.com/terms-of-service",
    translationKey: "termsOfService",
    icon: ScrollText,
  },
  {
    url: "https://www.sokosumi.com/privacy-policy",
    translationKey: "privacyPolicy",
    icon: Shield,
  },
  {
    url: "https://www.sokosumi.com/imprint",
    translationKey: "imprint",
    icon: Landmark,
  },
  {
    url: "https://www.sokosumi.com/acceptable-use",
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
  const activeOrganizationPath = activeOrganizationMember
    ? `/organizations/${activeOrganizationMember.organization.slug}`
    : null;

  const items: AccountNavItem[] = [
    {
      key: "account",
      href: "/account",
      translationKey: "account",
      Icon: UserIcon,
    },
  ];

  if (activeOrganizationPath) {
    items.push({
      key: "organizations",
      href: activeOrganizationPath,
      translationKey: "organizationsHeading",
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
