"use client";

import { Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{t("title")}</h3>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>

      <div className="space-y-4">
        {coworkerAssignments.map(({ coworker, assignments }) => (
          <CoworkerAssignmentCard
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

interface CoworkerAssignmentCardProps {
  vendorId: string;
  coworkerId: string;
  coworkerName: string;
  developerMembers: VendorMember[];
  assignments: VendorCoworkerAssignments["assignments"];
  isLoading: boolean;
  onAssignmentsChange: () => void;
}

function CoworkerAssignmentCard({
  vendorId,
  coworkerId,
  coworkerName,
  developerMembers,
  assignments,
  isLoading,
  onAssignmentsChange,
}: CoworkerAssignmentCardProps) {
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

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{coworkerName}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {assignedMembers.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {t("noAssignments")}
            </p>
          ) : (
            assignedMembers.map((member) => (
              <Badge key={member.id} variant="secondary" className="gap-1 pr-1">
                {memberLabel(member)}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-5"
                  disabled={isLoading || isMutating}
                  onClick={() => handleUnassign(member.id)}
                  aria-label={t("unassign", { developer: memberLabel(member) })}
                >
                  <X className="size-3" />
                </Button>
              </Badge>
            ))
          )}
        </div>

        {developerMembers.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noDevelopers")}</p>
        ) : availableMembers.length > 0 ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              disabled={isLoading || isMutating}
              onValueChange={handleAssign}
            >
              <SelectTrigger className="w-full sm:max-w-xs">
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
              <Loader2 className="text-muted-foreground size-4 animate-spin" />
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
