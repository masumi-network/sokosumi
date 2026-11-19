"use client";

import { contactDetailHref } from "@sokosumi/utils";
import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { toast } from "sonner";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

interface ContactWorkspaces {
  active: string | undefined;
  available: readonly string[];
}

const ContactLinkWorkspace = createContext<ContactWorkspaces | null>(null);

export function useContactLinkWorkspaces() {
  return useContext(ContactLinkWorkspace);
}

export function useContactWorkspaceId() {
  return useContactLinkWorkspaces()?.active;
}

export function ContactLinkWorkspaceProvider({
  workspaceId,
  available,
  children,
}: {
  workspaceId: string | undefined;
  available?: readonly string[];
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      active: workspaceId,
      available: available ?? (workspaceId ? [workspaceId] : []),
    }),
    [workspaceId, available],
  );
  return <ContactLinkWorkspace value={value}>{children}</ContactLinkWorkspace>;
}

export function CopyContactLinkItem({ contactId }: { contactId: string }) {
  const workspaceId = useContactWorkspaceId();
  const t = useTranslations("App.Contacts");
  return (
    <DropdownMenuItem
      onClick={() =>
        void navigator.clipboard
          ?.writeText(
            location.origin + contactDetailHref(contactId, workspaceId),
          )
          .then(() => toast.success(t("panel.linkCopied")))
      }
    >
      <Copy aria-hidden className="size-4" />
      {t("panel.copyLink")}
    </DropdownMenuItem>
  );
}
