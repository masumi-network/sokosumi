"use client";

import { Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  assignCoworkerDeveloperAction,
  unassignCoworkerDeveloperAction,
} from "@/lib/actions/vendors/vendor-admin.action";
import type { VendorMember } from "@/lib/clients/generated/core";
import type { VendorCoworkerAssignments } from "@/lib/services/vendor.service";

interface VendorCoworkerAssignmentsProps {
  vendorId: string;
  developerMembers: VendorMember[];
  coworkerAssignments: VendorCoworkerAssignments[];
  isLoading: boolean;
  onAssignmentsChange: () => void;
}

function memberLabel(member: VendorMember): string {
  return member.name?.trim() || member.email;
}

export function VendorCoworkerAssignments({
  vendorId,
  developerMembers,
  coworkerAssignments,
  isLoading,
  onAssignmentsChange,
}: VendorCoworkerAssignmentsProps) {
  const t = useTranslations("App.Developer.Vendors.assignments");

  if (coworkerAssignments.length === 0) {
    return (
      <div className="space-y-2">
        <h3 className="text-base font-semibold">{t("title")}</h3>
        <p className="text-muted-foreground text-sm">{t("emptyCoworkers")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{t("title")}</h3>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>

      <div className="divide-border divide-y rounded-lg border">
        {coworkerAssignments.map(({ coworker, assignments }) => (
          <CoworkerAssignmentRow
            key={coworker.id}
            vendorId={vendorId}
            coworkerId={coworker.id}
            coworkerName={coworker.name}
            developerMembers={developerMembers}
            assignments={assignments}
            isLoading={isLoading}
            onAssignmentsChange={onAssignmentsChange}
          />
        ))}
      </div>
    </div>
  );
}

interface CoworkerAssignmentRowProps {
  vendorId: string;
  coworkerId: string;
  coworkerName: string;
  developerMembers: VendorMember[];
  assignments: VendorCoworkerAssignments["assignments"];
  isLoading: boolean;
  onAssignmentsChange: () => void;
}

function CoworkerAssignmentRow({
  vendorId,
  coworkerId,
  coworkerName,
  developerMembers,
  assignments,
  isLoading,
  onAssignmentsChange,
}: CoworkerAssignmentRowProps) {
  const t = useTranslations("App.Developer.Vendors.assignments");
  const [isMutating, startMutation] = useTransition();

  const assignedUserIds = useMemo(
    () => new Set(assignments.map((assignment) => assignment.userId)),
    [assignments],
  );

  const assignedMembers = useMemo(
    () => developerMembers.filter((member) => assignedUserIds.has(member.id)),
    [assignedUserIds, developerMembers],
  );

  const availableMembers = useMemo(
    () => developerMembers.filter((member) => !assignedUserIds.has(member.id)),
    [assignedUserIds, developerMembers],
  );

  const handleAssign = useCallback(
    (userId: string) => {
      startMutation(async () => {
        const result = await assignCoworkerDeveloperAction({
          input: {
            vendorId,
            coworkerId,
            userId,
          },
        });

        if (!result.ok) {
          toast.error(result.error.message);
          return;
        }

        toast.success(t("assignSuccess"));
        onAssignmentsChange();
      });
    },
    [coworkerId, onAssignmentsChange, t, vendorId, startMutation],
  );

  const handleUnassign = useCallback(
    (userId: string) => {
      startMutation(async () => {
        const result = await unassignCoworkerDeveloperAction({
          input: {
            vendorId,
            coworkerId,
            userId,
          },
        });

        if (!result.ok) {
          toast.error(result.error.message);
          return;
        }

        toast.success(t("unassignSuccess"));
        onAssignmentsChange();
      });
    },
    [coworkerId, onAssignmentsChange, t, vendorId, startMutation],
  );

  const busy = isLoading || isMutating;

  return (
    <div className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
      <p className="min-w-0 shrink-0 text-sm font-medium sm:w-28">
        {coworkerName}
      </p>

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {assignedMembers.length === 0 ? (
          <p className="text-muted-foreground text-xs">{t("noAssignments")}</p>
        ) : (
          assignedMembers.map((member) => (
            <Badge
              key={member.id}
              variant="secondary"
              className="h-6 gap-0.5 py-0 pr-0.5 text-xs font-normal"
            >
              {memberLabel(member)}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-4"
                disabled={busy}
                onClick={() => handleUnassign(member.id)}
                aria-label={t("unassign", { developer: memberLabel(member) })}
              >
                <X className="size-2.5" />
              </Button>
            </Badge>
          ))
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
        {developerMembers.length === 0 ? (
          <p className="text-muted-foreground text-xs">{t("noDevelopers")}</p>
        ) : availableMembers.length > 0 ? (
          <>
            <Select disabled={busy} onValueChange={handleAssign}>
              <SelectTrigger size="sm" className="h-8 w-full min-w-40 sm:w-44">
                <SelectValue placeholder={t("assignPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {availableMembers.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {memberLabel(member)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isMutating ? (
              <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
