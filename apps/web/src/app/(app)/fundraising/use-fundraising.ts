"use client";
import type {
  FundraisingPipeline,
  FundraisingProspect,
} from "@sokosumi/core-client";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { coreErrorOf } from "@/app/contacts/contacts-view";
import { useSession } from "@/lib/auth/auth.client";
import { contactsService } from "@/lib/services/contacts.client";
import {
  type FundraisingProspectPatch,
  fundraisingService,
} from "@/lib/services/fundraising.client";
import { useScopedQuery } from "@/queries/scoped-queries";

export const FUNDRAISING_KEY = ["fundraising"] as const;
const ACCESS_KEY = ["fundraising-access"] as const;

/** The organization the raise belongs to; null while the session loads or in a personal workspace. */
export function useFundraisingOrganization(): string | null {
  const { data: session } = useSession();
  return session?.session.activeOrganizationId ?? null;
}

/** Whether this workspace has Fundraising; false until known. */
export function useFundraisingAccess(): boolean {
  const organizationId = useFundraisingOrganization();
  const query = useScopedQuery({
    scope: organizationId,
    queryKey: ACCESS_KEY,
    queryFn: () => fundraisingService.access(),
    enabled: organizationId !== null,
    staleTime: 5 * 60_000,
  });
  return query.data === true;
}

export function useFundraisingPipeline(initialData?: FundraisingPipeline) {
  const organizationId = useFundraisingOrganization();
  return useScopedQuery({
    scope: organizationId,
    queryKey: FUNDRAISING_KEY,
    queryFn: () => fundraisingService.pipeline(),
    enabled: organizationId !== null,
    initialData,
  });
}

export function useOrganizationMembers() {
  const organizationId = useFundraisingOrganization();
  return useScopedQuery({
    scope: organizationId,
    queryKey: ["organization-members"] as const,
    queryFn: () => contactsService.members(organizationId ?? ""),
    enabled: organizationId !== null,
    staleTime: 5 * 60_000,
  });
}

/**
 * Writes one investor's raise fields or contact fields. The row changes at
 * once and goes back on failure.
 */
export function useProspectUpdate() {
  const t = useTranslations("App.Fundraising");
  const cache = useQueryClient();
  const organizationId = useFundraisingOrganization();
  const key = [organizationId, ...FUNDRAISING_KEY] as const;

  function write(
    contactId: string,
    change: (prospect: FundraisingProspect) => FundraisingProspect,
  ) {
    cache.setQueryData<FundraisingPipeline>(key, (current) =>
      current
        ? {
            ...current,
            prospects: current.prospects.map((prospect) =>
              prospect.contact.id === contactId ? change(prospect) : prospect,
            ),
          }
        : current,
    );
  }

  async function run(
    contactId: string,
    optimistic: (prospect: FundraisingProspect) => FundraisingProspect,
    save: () => Promise<FundraisingProspect>,
  ): Promise<boolean> {
    const before = cache.getQueryData<FundraisingPipeline>(key);
    write(contactId, optimistic);
    try {
      const saved = await save();
      write(contactId, () => saved);
      return true;
    } catch (error) {
      if (before) cache.setQueryData(key, before);
      toast.error(coreErrorOf(error).message ?? t("saveFailed"));
      return false;
    }
  }

  return {
    /** Stage, owner, cheque, thesis, committed, notes, source. */
    updateProspect(
      prospect: FundraisingProspect,
      patch: FundraisingProspectPatch,
    ) {
      const { ownerUserId, ...rest } = patch;
      return run(
        prospect.contact.id,
        (current) => ({
          ...current,
          ...rest,
          ...(ownerUserId === null ? { owner: null } : {}),
        }),
        () => fundraisingService.updateProspect(prospect.contact.id, patch),
      );
    },
    /** Next step and follow-up date live on the contact. */
    updateContact(
      prospect: FundraisingProspect,
      fields: { nextStep?: string | null; followUpAt?: string | null },
    ) {
      return run(
        prospect.contact.id,
        (current) => ({
          ...current,
          contact: { ...current.contact, ...fields },
        }),
        async () => {
          const contact = await contactsService.update(prospect.contact.id, {
            ...fields,
            version: prospect.contact.version,
          });
          return { ...prospect, contact };
        },
      );
    },
  };
}
