"use client";

import { MemberRole, type MemberWithOrganization } from "@sokosumi/database";
import gravatarUrl from "gravatar-url";
import {
  ArrowLeftRight,
  BookOpen,
  Bot,
  Building2,
  Cable,
  Check,
  ChevronDown,
  CircleHelp,
  Landmark,
  LifeBuoy,
  ListChecks,
  LogOut,
  PanelLeft,
  Plus,
  ReceiptText,
  Scale,
  ScrollText,
  Shield,
  User as UserIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  type ComponentType,
  type MouseEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import UserAvatarContent from "@/app/components/user-avatar/user-avatar-content";
import { useWorkspaceSwitcher } from "@/app/components/user-avatar/workspace-switcher";
import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import {
  OrganizationInformationModal,
  OrganizationLogo,
} from "@/components/organizations";
import { Avatar } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import useModal from "@/hooks/use-modal";
import type { SessionUser } from "@/lib/auth/auth";
import { cn } from "@/lib/utils";

interface ProfileSwitchClientProps {
  sessionUser: SessionUser;
  members: MemberWithOrganization[];
  activeOrganizationId: string | null;
  secondaryLabel?: string;
}

interface WorkspaceItem {
  id: string | null;
  name: string;
  organization?: MemberWithOrganization["organization"];
}

function getWorkspaceKey(workspace: WorkspaceItem): string {
  return workspace.id ?? "personal-account";
}

interface HelpLinkItem {
  url: string;
  translationKey: "documentation" | "support";
  icon?: ComponentType<{ "aria-hidden"?: boolean; className?: string }>;
}

interface LegalLinkItem {
  url: string;
  translationKey:
    | "termsOfService"
    | "privacyPolicy"
    | "imprint"
    | "acceptableUse"
    | "serviceplanAiCoworker";
  icon?: ComponentType<{ "aria-hidden"?: boolean; className?: string }>;
}

const HELP_LINKS: HelpLinkItem[] = [
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

const LEGAL_LINKS: LegalLinkItem[] = [
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

function HelpLinks({
  handleOpenExternalLink,
  itemClassName,
  tUserAvatar,
}: {
  handleOpenExternalLink: (url: string) => void;
  itemClassName: string;
  tUserAvatar: (key: HelpLinkItem["translationKey"]) => string;
}) {
  return (
    <>
      {HELP_LINKS.map((item) => {
        const Icon = item.icon;
        return (
          <DropdownMenuItem
            key={item.translationKey}
            className={itemClassName}
            onClick={() => handleOpenExternalLink(item.url)}
          >
            {Icon ? (
              <Icon className="text-muted-foreground size-4" aria-hidden />
            ) : null}
            <span>{tUserAvatar(item.translationKey)}</span>
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

function LegalLinks({
  handleOpenExternalLink,
  itemClassName,
  tUserAvatar,
}: {
  handleOpenExternalLink: (url: string) => void;
  itemClassName: string;
  tUserAvatar: (key: LegalLinkItem["translationKey"]) => string;
}) {
  return (
    <>
      {LEGAL_LINKS.map((item) => {
        const Icon = item.icon;
        return (
          <DropdownMenuItem
            key={item.translationKey}
            className={itemClassName}
            onClick={() => handleOpenExternalLink(item.url)}
          >
            {Icon ? (
              <Icon className="text-muted-foreground size-4" aria-hidden />
            ) : null}
            <span>{tUserAvatar(item.translationKey)}</span>
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

function getOrderedWorkspaces(
  workspaces: WorkspaceItem[],
  activeOrganizationId: string | null,
): WorkspaceItem[] {
  const activeIndex = workspaces.findIndex(
    (workspace) => workspace.id === activeOrganizationId,
  );

  if (activeIndex <= 0) {
    return workspaces;
  }

  return [
    workspaces[activeIndex],
    ...workspaces.slice(0, activeIndex),
    ...workspaces.slice(activeIndex + 1),
  ];
}

function WorkspaceMenuItem({
  sessionUser,
  workspace,
  isSelected,
  isPending,
  itemClassName,
  onSelect,
}: {
  sessionUser: SessionUser;
  workspace: WorkspaceItem;
  isSelected: boolean;
  isPending: boolean;
  itemClassName: string;
  onSelect: (workspaceId: string | null) => void;
}) {
  return (
    <DropdownMenuItem
      className={itemClassName}
      disabled={isPending}
      onClick={() => onSelect(workspace.id)}
    >
      <WorkspaceAvatar sessionUser={sessionUser} workspace={workspace} />
      <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
      <Check
        className={cn("size-4", isSelected ? "opacity-100" : "opacity-0")}
      />
    </DropdownMenuItem>
  );
}

function WorkspaceSwitcherOptions({
  sessionUser,
  personalWorkspace,
  organizationWorkspaces,
  activeOrganizationId,
  isPending,
  itemClassName,
  organizationsHeading,
  addOrganizationLabel,
  onSelectWorkspace,
  onAddOrganization,
}: {
  sessionUser: SessionUser;
  personalWorkspace: WorkspaceItem;
  organizationWorkspaces: WorkspaceItem[];
  activeOrganizationId: string | null;
  isPending: boolean;
  itemClassName: string;
  organizationsHeading: string;
  addOrganizationLabel: string;
  onSelectWorkspace: (workspaceId: string | null) => void;
  onAddOrganization: () => void;
}) {
  return (
    <>
      <WorkspaceMenuItem
        sessionUser={sessionUser}
        workspace={personalWorkspace}
        isSelected={activeOrganizationId === null}
        isPending={isPending}
        itemClassName={itemClassName}
        onSelect={onSelectWorkspace}
      />
      {organizationWorkspaces.length > 0 ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
            {organizationsHeading}
          </DropdownMenuLabel>
          {organizationWorkspaces.map((workspace) => (
            <WorkspaceMenuItem
              key={getWorkspaceKey(workspace)}
              sessionUser={sessionUser}
              workspace={workspace}
              isSelected={workspace.id === activeOrganizationId}
              isPending={isPending}
              itemClassName={itemClassName}
              onSelect={onSelectWorkspace}
            />
          ))}
        </>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem className={itemClassName} onClick={onAddOrganization}>
        <Avatar className="bg-primary/10 flex size-6 items-center justify-center gap-2">
          <Plus className="text-primary size-4" />
        </Avatar>
        <span>{addOrganizationLabel}</span>
      </DropdownMenuItem>
    </>
  );
}

function WorkspaceAvatar({
  sessionUser,
  workspace,
}: {
  sessionUser: SessionUser;
  workspace: WorkspaceItem;
}) {
  if (workspace.organization) {
    return (
      <Avatar className="bg-muted size-6 items-center justify-center">
        <OrganizationLogo organization={workspace.organization} size={14} />
      </Avatar>
    );
  }

  return (
    <UserAvatarContent
      className="size-6 md:size-6"
      imageUrl={
        sessionUser.image ??
        gravatarUrl(sessionUser.email, {
          size: 80,
          default: "404",
        })
      }
      imageAlt={sessionUser.name ?? "User avatar"}
    />
  );
}

export default function ProfileSwitchClient({
  sessionUser,
  members,
  activeOrganizationId,
  secondaryLabel,
}: ProfileSwitchClientProps) {
  const tUserAvatar = useTranslations("Components.UserAvatar");
  const tOrganizationSwitcher = useTranslations(
    "Components.OrganizationSwitcher",
  );
  const { showLogoutModal } = useGlobalModalsContext();
  const activeOrganizationMember = activeOrganizationId
    ? members.find((member) => member.organizationId === activeOrganizationId)
    : null;
  const canViewBilling =
    !activeOrganizationId ||
    activeOrganizationMember?.role === MemberRole.OWNER ||
    activeOrganizationMember?.role === MemberRole.ADMIN;
  const { isPending, handleSelectWorkspace } = useWorkspaceSwitcher();
  const {
    Component: CreateOrganizationModal,
    showModal: showCreateOrganizationModal,
  } = useModal(OrganizationInformationModal, {
    organization: null,
  });
  const activeOrganizationPath = activeOrganizationMember
    ? `/organizations/${activeOrganizationMember.organization.slug}`
    : null;
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isWorkspaceSectionOpen, setIsWorkspaceSectionOpen] = useState(false);
  const [isHelpSectionOpen, setIsHelpSectionOpen] = useState(false);
  const [isLegalSectionOpen, setIsLegalSectionOpen] = useState(false);
  const { isMobile, state, toggleSidebar } = useSidebar();
  const isCollapsedDesktop = !isMobile && state === "collapsed";
  const canOpenMenu = isMobile || state !== "collapsed";
  const isDropdownVisible = canOpenMenu && isDropdownOpen;

  const handleDropdownOpenChange = (open: boolean) => {
    if (open && !isMobile && state === "collapsed") {
      return;
    }
    setIsDropdownOpen(open);
    if (!open) {
      setIsWorkspaceSectionOpen(false);
      setIsHelpSectionOpen(false);
      setIsLegalSectionOpen(false);
    }
  };

  useEffect(() => {
    if (isMobile) return;
    if (state === "collapsed") {
      const timer = setTimeout(() => {
        setIsDropdownOpen(false);
        setIsWorkspaceSectionOpen(false);
        setIsHelpSectionOpen(false);
        setIsLegalSectionOpen(false);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isMobile, state]);

  const personalWorkspace = useMemo<WorkspaceItem>(
    () => ({
      id: null,
      name:
        sessionUser.name ??
        sessionUser.email ??
        tOrganizationSwitcher("personalAccount"),
    }),
    [sessionUser.email, sessionUser.name, tOrganizationSwitcher],
  );

  const organizationWorkspaces = useMemo(
    () =>
      getOrderedWorkspaces(
        members.map((member) => ({
          id: member.organization.id,
          name: member.organization.name,
          organization: member.organization,
        })),
        activeOrganizationId,
      ),
    [activeOrganizationId, members],
  );

  const activeWorkspace =
    activeOrganizationId === null
      ? personalWorkspace
      : (organizationWorkspaces.find(
          (workspace) => workspace.id === activeOrganizationId,
        ) ?? personalWorkspace);
  const router = useRouter();

  const closeMenu = () => {
    setIsDropdownOpen(false);
    setIsWorkspaceSectionOpen(false);
    setIsHelpSectionOpen(false);
    setIsLegalSectionOpen(false);
  };

  const handleWorkspaceSelect = (workspaceId: string | null) => {
    closeMenu();
    handleSelectWorkspace(workspaceId);
    if (isMobile) {
      toggleSidebar();
    }
  };

  const handleAddOrganization = () => {
    closeMenu();
    showCreateOrganizationModal();
    if (isMobile) {
      toggleSidebar();
    }
  };

  const handleRouteNavigation = (path: string) => {
    router.push(path);
    closeMenu();
    if (isMobile) {
      toggleSidebar();
    }
  };

  const handleOpenExternalLink = (url: string) => {
    closeMenu();
    if (url.startsWith("mailto:")) {
      window.location.href = url;
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleExpandSidebar = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    toggleSidebar();
  };

  return (
    <>
      {CreateOrganizationModal}
      <SidebarGroup className="w-full p-0">
        <SidebarGroupContent>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu
                open={isDropdownVisible}
                onOpenChange={handleDropdownOpenChange}
              >
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    className="min-h-10 cursor-pointer items-center md:p-2"
                    aria-label={tUserAvatar("settings")}
                    tooltip={sessionUser.email}
                    disabled={isPending}
                  >
                    <div className="text-primary flex w-full items-center gap-2">
                      <span className="group-data-[collapsible=icon]:-ml-1 group-data-[collapsible=icon]:size-6">
                        <WorkspaceAvatar
                          sessionUser={sessionUser}
                          workspace={activeWorkspace}
                        />
                      </span>
                      <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
                        <div className="truncate text-sm font-semibold text-current">
                          {activeWorkspace?.name}
                        </div>
                      </div>
                      <ChevronDown className="text-muted-foreground size-4 shrink-0 group-data-[collapsible=icon]:hidden" />
                    </div>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-72" align="start">
                  <DropdownMenuLabel className="truncate">
                    <span className="block truncate text-sm font-medium">
                      {sessionUser.email}
                    </span>
                    {secondaryLabel ? (
                      <span className="text-muted-foreground mt-0.5 block truncate text-xs font-normal">
                        {secondaryLabel}
                      </span>
                    ) : null}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {isMobile ? (
                    <>
                      <DropdownMenuItem
                        className="cursor-pointer"
                        onSelect={(event) => {
                          event.preventDefault();
                          setIsWorkspaceSectionOpen((previous) => !previous);
                        }}
                      >
                        <ArrowLeftRight className="text-muted-foreground size-4" />
                        <span>{tOrganizationSwitcher("switchWorkspace")}</span>
                        <ChevronDown
                          className={cn(
                            "text-muted-foreground ml-auto size-4 transition-transform",
                            isWorkspaceSectionOpen ? "rotate-180" : "",
                          )}
                        />
                      </DropdownMenuItem>
                      {isWorkspaceSectionOpen ? (
                        <WorkspaceSwitcherOptions
                          sessionUser={sessionUser}
                          personalWorkspace={personalWorkspace}
                          organizationWorkspaces={organizationWorkspaces}
                          activeOrganizationId={activeOrganizationId}
                          isPending={isPending}
                          itemClassName="flex cursor-pointer items-center gap-2 py-2 pl-8"
                          organizationsHeading={tOrganizationSwitcher(
                            "organizationsHeading",
                          )}
                          addOrganizationLabel={tOrganizationSwitcher(
                            "addOrganization",
                          )}
                          onSelectWorkspace={handleWorkspaceSelect}
                          onAddOrganization={handleAddOrganization}
                        />
                      ) : null}
                    </>
                  ) : (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger className="gap-2">
                        <ArrowLeftRight className="text-muted-foreground size-4" />
                        <span>{tOrganizationSwitcher("switchWorkspace")}</span>
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="w-72">
                        <DropdownMenuGroup>
                          <WorkspaceSwitcherOptions
                            sessionUser={sessionUser}
                            personalWorkspace={personalWorkspace}
                            organizationWorkspaces={organizationWorkspaces}
                            activeOrganizationId={activeOrganizationId}
                            isPending={isPending}
                            itemClassName="flex cursor-pointer items-center gap-2 py-2"
                            organizationsHeading={tOrganizationSwitcher(
                              "organizationsHeading",
                            )}
                            addOrganizationLabel={tOrganizationSwitcher(
                              "addOrganization",
                            )}
                            onSelectWorkspace={handleWorkspaceSelect}
                            onAddOrganization={handleAddOrganization}
                          />
                        </DropdownMenuGroup>
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={() => handleRouteNavigation("/account")}
                    >
                      <UserIcon className="text-muted-foreground size-4" />
                      <span>{tUserAvatar("account")}</span>
                    </DropdownMenuItem>
                    {activeOrganizationPath ? (
                      <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() =>
                          handleRouteNavigation(activeOrganizationPath)
                        }
                      >
                        <Building2 className="text-muted-foreground size-4" />
                        <span>
                          {tOrganizationSwitcher("organizationsHeading")}
                        </span>
                      </DropdownMenuItem>
                    ) : null}
                    {canViewBilling ? (
                      <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleRouteNavigation("/billing")}
                      >
                        <ReceiptText className="text-muted-foreground size-4" />
                        <span>{tUserAvatar("billing")}</span>
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={() => handleRouteNavigation("/connections")}
                    >
                      <Cable className="text-muted-foreground size-4" />
                      <span>{tUserAvatar("connections")}</span>
                    </DropdownMenuItem>
                    {isMobile ? (
                      <>
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onSelect={(event) => {
                            event.preventDefault();
                            setIsHelpSectionOpen((previous) => !previous);
                          }}
                        >
                          <LifeBuoy className="text-muted-foreground size-4" />
                          <span>{tUserAvatar("help")}</span>
                          <ChevronDown
                            className={cn(
                              "text-muted-foreground ml-auto size-4 transition-transform",
                              isHelpSectionOpen ? "rotate-180" : "",
                            )}
                          />
                        </DropdownMenuItem>
                        {isHelpSectionOpen ? (
                          <HelpLinks
                            handleOpenExternalLink={handleOpenExternalLink}
                            itemClassName="cursor-pointer pl-8"
                            tUserAvatar={tUserAvatar}
                          />
                        ) : null}
                        <DropdownMenuItem
                          className="cursor-pointer"
                          onSelect={(event) => {
                            event.preventDefault();
                            setIsLegalSectionOpen((previous) => !previous);
                          }}
                        >
                          <Scale className="text-muted-foreground size-4" />
                          <span>{tUserAvatar("legal")}</span>
                          <ChevronDown
                            className={cn(
                              "text-muted-foreground ml-auto size-4 transition-transform",
                              isLegalSectionOpen ? "rotate-180" : "",
                            )}
                          />
                        </DropdownMenuItem>
                        {isLegalSectionOpen ? (
                          <LegalLinks
                            handleOpenExternalLink={handleOpenExternalLink}
                            itemClassName="cursor-pointer pl-8"
                            tUserAvatar={tUserAvatar}
                          />
                        ) : null}
                      </>
                    ) : (
                      <>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger className="gap-2">
                            <LifeBuoy className="text-muted-foreground size-4" />
                            <span>{tUserAvatar("help")}</span>
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="w-64">
                            <HelpLinks
                              handleOpenExternalLink={handleOpenExternalLink}
                              itemClassName="cursor-pointer"
                              tUserAvatar={tUserAvatar}
                            />
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger className="gap-2">
                            <Scale className="text-muted-foreground size-4" />
                            <span>{tUserAvatar("legal")}</span>
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent className="w-64">
                            <LegalLinks
                              handleOpenExternalLink={handleOpenExternalLink}
                              itemClassName="cursor-pointer"
                              tUserAvatar={tUserAvatar}
                            />
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                      </>
                    )}
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() => {
                      closeMenu();
                      showLogoutModal(sessionUser.email);
                    }}
                  >
                    <LogOut className="text-muted-foreground size-4" />
                    <span>{tUserAvatar("logout")}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {isCollapsedDesktop ? (
                <button
                  type="button"
                  aria-label={tUserAvatar("expandSidebar")}
                  title={tUserAvatar("expandSidebar")}
                  onClick={handleExpandSidebar}
                  className="text-muted-foreground hover:text-sidebar-accent-foreground group-hover/menu-item:bg-sidebar-accent group-focus-within/menu-item:bg-sidebar-accent pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md bg-transparent opacity-0 transition-all duration-150 group-focus-within/menu-item:pointer-events-auto group-focus-within/menu-item:opacity-100 group-hover/menu-item:pointer-events-auto group-hover/menu-item:opacity-100"
                >
                  <PanelLeft className="size-4" />
                </button>
              ) : null}
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    </>
  );
}
