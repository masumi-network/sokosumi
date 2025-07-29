"use client";

import { Check, ChevronsUpDown, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { OrganizationLogo } from "@/components/organizations";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { authClient } from "@/lib/auth/auth.client";
import { MemberWithOrganization } from "@/lib/db";
import { cn } from "@/lib/utils";

interface OrganizationSwitcherProps {
  members: MemberWithOrganization[];
  activeOrganizationId: string | null;
  sessionUserName: string | null;
}

export function OrganizationSwitcher({
  members,
  activeOrganizationId,
  sessionUserName,
}: OrganizationSwitcherProps) {
  const t = useTranslations("Components.OrganizationSwitcher");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const activeOrganization = members.find(
    (member) => member.organization.id === activeOrganizationId,
  )?.organization;

  const handleSelectOrganization = (organizationId: string | null) => {
    startTransition(async () => {
      try {
        await authClient.organization.setActive({
          organizationId,
        });
        setOpen(false);
        router.refresh();
      } catch (error) {
        console.error("Failed to switch organization:", error);
      }
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          role="combobox"
          aria-expanded={open}
          aria-label="Select organization"
          className={cn("w-full justify-between", isPending && "opacity-50")}
          disabled={isPending}
        >
          <div className="flex items-center truncate">
            <span className="truncate">
              {activeOrganization
                ? activeOrganization.name
                : (sessionUserName ?? t("personalAccount"))}
            </span>
          </div>
          <ChevronsUpDown className="ml-auto h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command>
          <CommandList>
            <CommandEmpty>{t("noOrganizationsFound")}</CommandEmpty>
            <CommandGroup heading={t("personalAccountHeading")}>
              <CommandItem
                value="personal"
                onSelect={() => handleSelectOrganization(null)}
              >
                <User className="mr-2 h-4 w-4" />
                <span className="truncate">
                  {sessionUserName ?? t("personalAccount")}
                </span>
                <Check
                  className={cn(
                    "ml-auto h-4 w-4",
                    activeOrganizationId === null ? "opacity-100" : "opacity-0",
                  )}
                />
              </CommandItem>
            </CommandGroup>
            {members.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup heading={t("organizationsHeading")}>
                  {members.map((member) => (
                    <CommandItem
                      key={member.organization.id}
                      value={member.organization.name}
                      onSelect={() =>
                        handleSelectOrganization(member.organization.id)
                      }
                    >
                      <OrganizationLogo
                        organization={member.organization}
                        size={16}
                      />
                      <span className="ml-2 truncate">
                        {member.organization.name}
                      </span>
                      <Check
                        className={cn(
                          "ml-auto h-4 w-4",
                          activeOrganizationId === member.organization.id
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
