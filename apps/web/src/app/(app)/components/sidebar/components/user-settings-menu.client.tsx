"use client";

import { MemberRole, MemberWithOrganization } from "@sokosumi/database";
import {
  BookOpen,
  Building2,
  Cable,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  LifeBuoy,
  LogOut,
  ReceiptText,
  Settings as SettingsIcon,
  User as UserIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { useGlobalModalsContext } from "@/components/modals/global-modals-context";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { SessionUser } from "@/lib/auth/auth";
import { cn } from "@/lib/utils";

interface UserSettingsMenuClientProps {
  sessionUser: SessionUser;
  members: MemberWithOrganization[];
  activeOrganizationId: string | null;
  secondaryLabel?: string;
}

export default function UserSettingsMenuClient({
  sessionUser,
  members,
  activeOrganizationId,
  secondaryLabel,
}: UserSettingsMenuClientProps) {
  const t = useTranslations("Components.UserAvatar");
  const activeOrganizationMember = activeOrganizationId
    ? members.find((member) => member.organizationId === activeOrganizationId)
    : null;
  const canViewBilling =
    !activeOrganizationId ||
    activeOrganizationMember?.role === MemberRole.OWNER ||
    activeOrganizationMember?.role === MemberRole.ADMIN;

  const { showLogoutModal } = useGlobalModalsContext();
  const router = useRouter();
  const { isMobile, state, toggleSidebar } = useSidebar();
  const [isPopoverOpen, setIsPopoverOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isHelpPopoverOpen, setIsHelpPopoverOpen] = useState(false);
  const [isHelpSectionOpen, setIsHelpSectionOpen] = useState(false);
  const helpCloseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const isSidebarCollapsed = !isMobile && state === "collapsed";
  const canOpenMenu = isMobile || state !== "collapsed";
  const isPopoverVisible = canOpenMenu && isPopoverOpen;
  const isDropdownVisible = canOpenMenu && isDropdownOpen;

  const closeMenu = () => {
    setIsPopoverOpen(false);
    setIsDropdownOpen(false);
    setIsHelpPopoverOpen(false);
    setIsHelpSectionOpen(false);
  };

  const handlePopoverOpenChange = (open: boolean) => {
    if (open && !isMobile && state === "collapsed") {
      return;
    }

    setIsPopoverOpen(open);
    if (!open) {
      setIsHelpPopoverOpen(false);
    }
  };
  const handleDropdownOpenChange = (open: boolean) => {
    if (open && !isMobile && state === "collapsed") {
      return;
    }
    setIsDropdownOpen(open);
    if (!open) {
      setIsHelpPopoverOpen(false);
      setIsHelpSectionOpen(false);
    }
  };

  useEffect(() => {
    if (isMobile) {
      return;
    }

    if (state === "collapsed") {
      const timer = setTimeout(() => {
        setIsPopoverOpen(false);
        setIsDropdownOpen(false);
        setIsHelpPopoverOpen(false);
      }, 100);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      setIsPopoverOpen(false);
      setIsDropdownOpen(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [isMobile, state]);

  useEffect(
    () => () => {
      if (helpCloseTimeoutRef.current) {
        clearTimeout(helpCloseTimeoutRef.current);
      }
    },
    [],
  );

  const openHelpPopover = () => {
    if (helpCloseTimeoutRef.current) {
      clearTimeout(helpCloseTimeoutRef.current);
      helpCloseTimeoutRef.current = null;
    }
    setIsHelpPopoverOpen(true);
  };

  const scheduleCloseHelpPopover = () => {
    if (helpCloseTimeoutRef.current) {
      clearTimeout(helpCloseTimeoutRef.current);
    }

    helpCloseTimeoutRef.current = setTimeout(() => {
      setIsHelpPopoverOpen(false);
      helpCloseTimeoutRef.current = null;
    }, 120);
  };

  const handleOpenExternalLink = (url: string) => {
    if (url.startsWith("mailto:")) {
      window.location.href = url;
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleRouteNavigation = (path: string) => {
    router.push(path);
    closeMenu();
    if (isMobile) {
      toggleSidebar();
    }
  };

  return (
    <SidebarGroup className="w-full pb-0">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            {isMobile ? (
              <DropdownMenu
                open={isDropdownVisible}
                onOpenChange={handleDropdownOpenChange}
              >
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    className={cn(
                      "min-h-[56px] cursor-pointer items-center md:p-2",
                      isSidebarCollapsed ? "justify-center" : "",
                    )}
                    aria-label={t("settings")}
                    tooltip={sessionUser.email}
                  >
                    <div className="text-primary flex w-full items-center gap-2">
                      <span className="flex shrink-0 group-data-[collapsible=icon]:-ml-0.5 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:pt-1.5">
                        <SettingsIcon className="text-muted-foreground size-5" />
                      </span>
                      {!isSidebarCollapsed ? (
                        <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-1">
                          <span className="text-sm leading-none font-semibold">
                            {t("settings")}
                          </span>
                          {secondaryLabel ? (
                            <span className="text-muted-foreground truncate text-xs leading-none">
                              {secondaryLabel}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {!isSidebarCollapsed ? (
                        <ChevronDown className="text-muted-foreground size-4 shrink-0" />
                      ) : null}
                    </div>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-72" align="start">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-muted-foreground truncate">
                      {sessionUser.email}
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={() => handleRouteNavigation("/account")}
                    >
                      <UserIcon className="text-muted-foreground size-4" />
                      <span>{t("account")}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={() => handleRouteNavigation("/organizations")}
                    >
                      <Building2 className="text-muted-foreground size-4" />
                      <span>{t("organizations")}</span>
                    </DropdownMenuItem>
                    {canViewBilling ? (
                      <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => handleRouteNavigation("/billing")}
                      >
                        <ReceiptText className="text-muted-foreground size-4" />
                        <span>{t("billing")}</span>
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      className="cursor-pointer"
                      onClick={() => handleRouteNavigation("/connections")}
                    >
                      <Cable className="text-muted-foreground size-4" />
                      <span>{t("connections")}</span>
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onSelect={(event) => {
                      event.preventDefault();
                      setIsHelpSectionOpen((prev) => !prev);
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <LifeBuoy className="text-muted-foreground size-4" />
                      <span>{t("help")}</span>
                    </span>
                    <ChevronRight
                      className={cn(
                        "text-muted-foreground ml-auto size-4 transition-transform",
                        isHelpSectionOpen ? "rotate-90" : "",
                      )}
                    />
                  </DropdownMenuItem>
                  {isHelpSectionOpen ? (
                    <>
                      <DropdownMenuItem
                        className="cursor-pointer pl-8"
                        onClick={() => {
                          closeMenu();
                          handleOpenExternalLink(
                            "https://docs.sokosumi.com/documentation",
                          );
                        }}
                      >
                        <BookOpen className="text-muted-foreground size-4" />
                        <span>{t("documentation")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="cursor-pointer pl-8"
                        onClick={() => {
                          closeMenu();
                          handleOpenExternalLink("mailto:info@sokosumi.com");
                        }}
                      >
                        <CircleHelp className="text-muted-foreground size-4" />
                        <span>{t("support")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-muted-foreground pl-8 text-xs">
                        {t("legal")}
                      </DropdownMenuLabel>
                      <DropdownMenuItem
                        className="cursor-pointer pl-8"
                        onClick={() => {
                          closeMenu();
                          handleOpenExternalLink(
                            "https://www.sokosumi.com/terms-of-service",
                          );
                        }}
                      >
                        <span>{t("termsOfService")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="cursor-pointer pl-8"
                        onClick={() => {
                          closeMenu();
                          handleOpenExternalLink(
                            "https://www.sokosumi.com/privacy-policy",
                          );
                        }}
                      >
                        <span>{t("privacyPolicy")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="cursor-pointer pl-8"
                        onClick={() => {
                          closeMenu();
                          handleOpenExternalLink(
                            "https://www.sokosumi.com/imprint",
                          );
                        }}
                      >
                        <span>{t("imprint")}</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="cursor-pointer pl-8"
                        onClick={() => {
                          closeMenu();
                          handleOpenExternalLink(
                            "https://www.sokosumi.com/acceptable-use",
                          );
                        }}
                      >
                        <span>{t("acceptableUse")}</span>
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={() => {
                      closeMenu();
                      showLogoutModal(sessionUser.email);
                    }}
                  >
                    <LogOut className="text-muted-foreground size-4" />
                    <span>{t("logout")}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Popover
                open={isPopoverVisible}
                onOpenChange={handlePopoverOpenChange}
              >
                <PopoverTrigger asChild>
                  <SidebarMenuButton
                    className={cn(
                      "min-h-[56px] cursor-pointer items-center md:p-2",
                      isSidebarCollapsed ? "justify-center" : "",
                    )}
                    aria-label={t("settings")}
                    tooltip={sessionUser.email}
                  >
                    <div className="text-primary flex w-full items-center gap-2">
                      <span className="flex shrink-0 group-data-[collapsible=icon]:-ml-0.5 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:pt-1.5">
                        <SettingsIcon className="text-muted-foreground size-5" />
                      </span>
                      {!isSidebarCollapsed ? (
                        <div className="flex min-w-0 flex-1 flex-col items-start justify-center gap-1">
                          <span className="text-sm leading-none font-semibold">
                            {t("settings")}
                          </span>
                          {secondaryLabel ? (
                            <span className="text-muted-foreground truncate text-xs leading-none">
                              {secondaryLabel}
                            </span>
                          ) : null}
                        </div>
                      ) : null}
                      {!isSidebarCollapsed ? (
                        <ChevronDown className="text-muted-foreground size-4 shrink-0" />
                      ) : null}
                    </div>
                  </SidebarMenuButton>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-72 p-0" side="right">
                  <Command>
                    <CommandList>
                      <CommandGroup heading={sessionUser.email}>
                        <CommandItem
                          className="cursor-pointer"
                          onSelect={() => handleRouteNavigation("/account")}
                        >
                          <UserIcon className="text-muted-foreground size-4" />
                          <span>{t("account")}</span>
                        </CommandItem>
                        <CommandItem
                          className="cursor-pointer"
                          onSelect={() =>
                            handleRouteNavigation("/organizations")
                          }
                        >
                          <Building2 className="text-muted-foreground size-4" />
                          <span>{t("organizations")}</span>
                        </CommandItem>
                        {canViewBilling ? (
                          <CommandItem
                            className="cursor-pointer"
                            onSelect={() => handleRouteNavigation("/billing")}
                          >
                            <ReceiptText className="text-muted-foreground size-4" />
                            <span>{t("billing")}</span>
                          </CommandItem>
                        ) : null}
                        <CommandItem
                          className="cursor-pointer"
                          onSelect={() => handleRouteNavigation("/connections")}
                        >
                          <Cable className="text-muted-foreground size-4" />
                          <span>{t("connections")}</span>
                        </CommandItem>
                        <Popover
                          open={isHelpPopoverOpen}
                          onOpenChange={setIsHelpPopoverOpen}
                        >
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="aria-selected:bg-accent aria-selected:text-accent-foreground flex w-full cursor-pointer items-center justify-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden"
                              onMouseEnter={openHelpPopover}
                              onMouseLeave={scheduleCloseHelpPopover}
                            >
                              <LifeBuoy className="text-muted-foreground size-4" />
                              <span className="flex-1">{t("help")}</span>
                              <ChevronRight className="text-muted-foreground size-4" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-64 p-0"
                            side="right"
                            align="start"
                            onMouseEnter={openHelpPopover}
                            onMouseLeave={scheduleCloseHelpPopover}
                          >
                            <Command>
                              <CommandList>
                                <CommandGroup>
                                  <CommandItem
                                    className="cursor-pointer"
                                    onSelect={() => {
                                      closeMenu();
                                      handleOpenExternalLink(
                                        "https://docs.sokosumi.com/documentation",
                                      );
                                    }}
                                  >
                                    <BookOpen className="text-muted-foreground size-4" />
                                    <span>{t("documentation")}</span>
                                  </CommandItem>
                                  <CommandItem
                                    className="cursor-pointer"
                                    onSelect={() => {
                                      closeMenu();
                                      handleOpenExternalLink(
                                        "mailto:info@sokosumi.com",
                                      );
                                    }}
                                  >
                                    <CircleHelp className="text-muted-foreground size-4" />
                                    <span>{t("support")}</span>
                                  </CommandItem>
                                  <CommandSeparator />
                                  <div className="text-muted-foreground px-2 py-1.5 text-xs">
                                    {t("legal")}
                                  </div>
                                  <CommandItem
                                    className="cursor-pointer"
                                    onSelect={() => {
                                      closeMenu();
                                      handleOpenExternalLink(
                                        "https://www.sokosumi.com/terms-of-service",
                                      );
                                    }}
                                  >
                                    <span>{t("termsOfService")}</span>
                                  </CommandItem>
                                  <CommandItem
                                    className="cursor-pointer"
                                    onSelect={() => {
                                      closeMenu();
                                      handleOpenExternalLink(
                                        "https://www.sokosumi.com/privacy-policy",
                                      );
                                    }}
                                  >
                                    <span>{t("privacyPolicy")}</span>
                                  </CommandItem>
                                  <CommandItem
                                    className="cursor-pointer"
                                    onSelect={() => {
                                      closeMenu();
                                      handleOpenExternalLink(
                                        "https://www.sokosumi.com/imprint",
                                      );
                                    }}
                                  >
                                    <span>{t("imprint")}</span>
                                  </CommandItem>
                                  <CommandItem
                                    className="cursor-pointer"
                                    onSelect={() => {
                                      closeMenu();
                                      handleOpenExternalLink(
                                        "https://www.sokosumi.com/acceptable-use",
                                      );
                                    }}
                                  >
                                    <span>{t("acceptableUse")}</span>
                                  </CommandItem>
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </CommandGroup>
                      <CommandSeparator />
                      <CommandGroup>
                        <CommandItem
                          className="cursor-pointer"
                          onSelect={() => {
                            closeMenu();
                            showLogoutModal(sessionUser.email);
                          }}
                        >
                          <LogOut className="text-muted-foreground size-4" />
                          <span>{t("logout")}</span>
                        </CommandItem>
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
