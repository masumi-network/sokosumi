"use client";

import { contactDetailHref } from "@sokosumi/utils";
import { Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { createContext, type ReactNode, useContext } from "react";
import { toast } from "sonner";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

const ContactLinkWorkspace = createContext<string | undefined>(undefined);

export function useContactWorkspaceId() {
  return useContext(ContactLinkWorkspace);
}

export function ContactLinkWorkspaceProvider({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  return (
    <ContactLinkWorkspace value={workspaceId}>{children}</ContactLinkWorkspace>
  );
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
