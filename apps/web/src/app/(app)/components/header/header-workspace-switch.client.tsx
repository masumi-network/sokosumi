"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import type { SessionUser } from "@sokosumi/utils";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { CreateOrganizationWizard } from "@/components/organizations";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import useModal from "@/hooks/use-modal";
import { WorkspaceGateErrorCode } from "@/lib/actions/errors";
import { createPersonalWorkspaceAction } from "@/lib/actions/workspace-gate";
import { authClient } from "@/lib/auth/auth.client";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";
import { type NameFormType, nameFormSchema } from "@/lib/schemas";
import { cn } from "@/lib/utils";

import HeaderWorkspaceAvatar from "./header-workspace-avatar";

interface HeaderWorkspaceSwitchProps {
  sessionUser: SessionUser;
  members: MemberWithOrganization[];
  hasPersonalWorkspace: boolean;
  activeOrganizationId: string | null;
  isPending: boolean;
  onSelectWorkspace: (workspaceId: string | null) => void;
}

interface WorkspaceItem {
  id: string | null;
  name: string;
  organization?: MemberWithOrganization["organization"];
}

function getWorkspaceKey(workspace: WorkspaceItem): string {
  return workspace.id ?? "personal-account";
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

function WorkspaceAvatar({
  sessionUser,
  workspace,
}: {
  sessionUser: SessionUser;
  workspace: WorkspaceItem;
}) {
  return (
    <HeaderWorkspaceAvatar
      sessionUser={sessionUser}
      organization={workspace.organization ?? null}
      className="size-6 md:size-6"
      logoSize={14}
    />
  );
}

function WorkspaceMenuItem({
  sessionUser,
  workspace,
  isSelected,
  isPending,
  onSelect,
}: {
  sessionUser: SessionUser;
  workspace: WorkspaceItem;
  isSelected: boolean;
  isPending: boolean;
  onSelect: (workspaceId: string | null) => void;
}) {
  return (
    <DropdownMenuItem
      className="flex cursor-pointer items-center gap-2 py-2"
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

export default function HeaderWorkspaceSwitch({
  sessionUser,
  members,
  hasPersonalWorkspace,
  activeOrganizationId,
  isPending,
  onSelectWorkspace,
}: HeaderWorkspaceSwitchProps) {
  const tOrganizationSwitcher = useTranslations(
    "Components.OrganizationSwitcher",
  );
  const {
    Component: CreateOrganizationModal,
    showModal: showCreateOrganizationModal,
  } = useModal(CreateOrganizationWizard);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isNameDialogOpen, setIsNameDialogOpen] = useState(false);
  const [isCreatingPersonal, setIsCreatingPersonal] = useState(false);
  const tIdentity = useTranslations("WorkspaceGate.Identity");
  const tSchema = useTranslations("Library.Auth.Schema");
  const nameForm = useForm<NameFormType>({
    resolver: zodResolver(nameFormSchema(tSchema)),
    defaultValues: { name: sessionUser.name ?? "" },
  });

  const hasDisplayName = Boolean(sessionUser.name?.trim());

  async function persistDisplayName(name: string): Promise<boolean> {
    try {
      const updateUserResult = await authClient.updateUser({ name });
      if (updateUserResult.error) {
        toast.error(
          updateUserResult.error.message ?? tIdentity("nameUpdateError"),
        );
        return false;
      }
      return true;
    } catch (error) {
      console.error("Create personal workspace name persist failed", error);
      toast.error(tIdentity("nameUpdateError"));
      return false;
    }
  }

  async function createAndActivatePersonal(): Promise<void> {
    const createResult = await createPersonalWorkspaceAction({});
    if (!createResult.ok) {
      if (
        createResult.error.code ===
        WorkspaceGateErrorCode.PERSONAL_WORKSPACE_ALREADY_EXISTS
      ) {
        onSelectWorkspace(null);
        return;
      }
      console.error("Create personal workspace failed", createResult.error);
      toast.error(tIdentity("personalCreateError"));
      return;
    }
    onSelectWorkspace(null);
  }

  async function handleCreatePersonalWorkspace() {
    setIsDropdownOpen(false);
    if (!hasDisplayName) {
      setIsNameDialogOpen(true);
      return;
    }

    setIsCreatingPersonal(true);
    try {
      await createAndActivatePersonal();
    } finally {
      setIsCreatingPersonal(false);
    }
  }

  async function handleNameDialogSubmit(values: NameFormType) {
    setIsCreatingPersonal(true);
    try {
      if (!(await persistDisplayName(values.name))) {
        return;
      }
      await createAndActivatePersonal();
      setIsNameDialogOpen(false);
    } finally {
      setIsCreatingPersonal(false);
    }
  }

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
      ? hasPersonalWorkspace
        ? personalWorkspace
        : null
      : (organizationWorkspaces.find(
          (workspace) => workspace.id === activeOrganizationId,
        ) ?? null);

  const handleWorkspaceSelect = (workspaceId: string | null) => {
    if (workspaceId === null && !hasPersonalWorkspace) {
      return;
    }
    setIsDropdownOpen(false);
    onSelectWorkspace(workspaceId);
  };

  const handleCreateOrganization = () => {
    setIsDropdownOpen(false);
    showCreateOrganizationModal();
  };

  return (
    <>
      {CreateOrganizationModal}
      <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="text-foreground hover:opacity-80 flex h-8 min-w-0 items-center text-sm transition-opacity md:h-auto"
            disabled={isPending}
            aria-busy={!activeWorkspace}
            aria-label={
              activeWorkspace
                ? undefined
                : tOrganizationSwitcher("switchWorkspace")
            }
          >
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-1.5">
              {activeWorkspace ? (
                <>
                  <span className="max-w-24 truncate text-right leading-none font-medium md:max-w-none md:leading-tight">
                    {activeWorkspace.name}
                  </span>
                  <HeaderWorkspaceAvatar
                    sessionUser={sessionUser}
                    organization={activeWorkspace.organization ?? null}
                    className="size-4 shrink-0"
                    logoSize={12}
                    decorative
                  />
                </>
              ) : (
                <span
                  data-testid="workspace-switcher-skeleton"
                  className="col-span-2 flex items-center justify-end gap-1.5"
                  aria-hidden
                >
                  <span className="bg-muted h-3 w-20 animate-pulse rounded-md" />
                  <span className="bg-muted size-4 shrink-0 animate-pulse rounded-full" />
                </span>
              )}
              <ChevronsUpDown className="text-muted-foreground size-4 shrink-0 self-center md:row-span-2 md:size-4.5" />
              <span className="text-muted-foreground col-span-2 col-start-1 max-md:hidden max-w-full truncate text-right text-xs leading-tight">
                {sessionUser.email}
              </span>
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72" align="end">
          {hasPersonalWorkspace ? (
            <WorkspaceMenuItem
              sessionUser={sessionUser}
              workspace={personalWorkspace}
              isSelected={activeOrganizationId === null}
              isPending={isPending || isCreatingPersonal}
              onSelect={handleWorkspaceSelect}
            />
          ) : (
            <DropdownMenuItem
              className="flex cursor-pointer items-center gap-2 py-2"
              disabled={isPending || isCreatingPersonal}
              onClick={() => {
                void handleCreatePersonalWorkspace();
              }}
            >
              <Avatar className="bg-primary/10 flex size-6 items-center justify-center gap-2">
                <Plus className="text-primary size-4" />
              </Avatar>
              <span>{tOrganizationSwitcher("createPersonalWorkspace")}</span>
            </DropdownMenuItem>
          )}
          {organizationWorkspaces.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
                {tOrganizationSwitcher("organizationsHeading")}
              </DropdownMenuLabel>
              {organizationWorkspaces.map((workspace) => (
                <WorkspaceMenuItem
                  key={getWorkspaceKey(workspace)}
                  sessionUser={sessionUser}
                  workspace={workspace}
                  isSelected={workspace.id === activeOrganizationId}
                  isPending={isPending || isCreatingPersonal}
                  onSelect={handleWorkspaceSelect}
                />
              ))}
            </>
          ) : null}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="flex cursor-pointer items-center gap-2 py-2"
            onClick={handleCreateOrganization}
          >
            <Avatar className="bg-primary/10 flex size-6 items-center justify-center gap-2">
              <Plus className="text-primary size-4" />
            </Avatar>
            <span>{tOrganizationSwitcher("createOrganization")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={isNameDialogOpen} onOpenChange={setIsNameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tOrganizationSwitcher("createPersonalWorkspace")}
            </DialogTitle>
          </DialogHeader>
          <Form {...nameForm}>
            <form
              onSubmit={nameForm.handleSubmit(handleNameDialogSubmit)}
              className="space-y-4"
            >
              <FormField
                control={nameForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tIdentity("displayNameLabel")}</FormLabel>
                    <FormControl>
                      <Input {...field} autoComplete="name" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button type="submit" disabled={isCreatingPersonal}>
                  {tOrganizationSwitcher("createPersonalWorkspace")}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
