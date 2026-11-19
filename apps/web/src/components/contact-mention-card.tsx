"use client";

import { contactDetailHref } from "@sokosumi/utils";
import { useQuery } from "@tanstack/react-query";
import { ContactRound } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  createContext,
  type PointerEvent,
  type ReactNode,
  use,
  useId,
  useRef,
  useState,
} from "react";
import { useContactLinkWorkspaces } from "@/app/contacts/components/contact-link-workspace";
import { contactKey } from "@/app/contacts/components/use-contacts-data";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import useIsClient from "@/hooks/use-is-client";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { contactsService } from "@/lib/services/contacts.client";
import type { ContactMentionTarget } from "./contact-mention-target";

const Enabled = createContext(false);

export function ContactMentionScope({ children }: { children: ReactNode }) {
  return <Enabled value>{children}</Enabled>;
}

export function ContactMentionCard({
  target,
  children,
  fallback,
}: {
  target: ContactMentionTarget;
  children: ReactNode;
  fallback: ReactNode;
}) {
  const enabled = use(Enabled);
  const workspaces = useContactLinkWorkspaces();
  const client = useIsClient();
  if (
    !enabled ||
    !workspaces ||
    (target.origin && (!client || target.origin !== window.location.origin))
  ) {
    return fallback;
  }
  const sourceWorkspace = target.workspaceId ?? workspaces.active;
  return (
    <ContactMentionPopover label={children}>
      <ContactMentionDetails
        id={target.id}
        workspaceId={sourceWorkspace}
        active={Boolean(
          sourceWorkspace && workspaces.active === sourceWorkspace,
        )}
        accessible={Boolean(
          sourceWorkspace && workspaces.available.includes(sourceWorkspace),
        )}
      />
    </ContactMentionPopover>
  );
}

// Match a room @mention's hover delays. Click and keyboard activation pin
// the card so the reader can use its link on touch or with a keyboard.
const HOVER_OPEN_MS = 100;
const HOVER_CLOSE_MS = 300;
function ContactMentionPopover({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState<"hover" | "selected" | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const returnFocus = useRef(false);
  const id = useId();
  const clearTimer = () => window.clearTimeout(timer.current);
  useMountEffect(() => clearTimer);

  function hover(event: PointerEvent) {
    if (event.pointerType !== "mouse") return;
    clearTimer();
    if (open) return;
    timer.current = window.setTimeout(() => {
      returnFocus.current = false;
      setOpen("hover");
    }, HOVER_OPEN_MS);
  }
  function leave(event: PointerEvent) {
    if (event.pointerType !== "mouse") return;
    clearTimer();
    if (open === "hover")
      timer.current = window.setTimeout(() => setOpen(null), HOVER_CLOSE_MS);
  }
  function select(next: boolean) {
    clearTimer();
    if (next) returnFocus.current = true;
    setOpen(next ? "selected" : null);
  }

  return (
    <Popover open={open !== null} onOpenChange={select}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          className="text-foreground hover:bg-quinary focus-visible:ring-ring inline cursor-pointer rounded-sm px-0.5 text-start font-medium underline underline-offset-2 focus-visible:ring-2"
          onPointerEnter={hover}
          onPointerLeave={leave}
          onClick={(event) => {
            if (open === "hover") {
              event.preventDefault();
              select(true);
            }
          }}
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        aria-labelledby={id}
        className="w-64 space-y-2"
        onPointerEnter={hover}
        onPointerLeave={leave}
        onOpenAutoFocus={(event) => {
          if (!returnFocus.current) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocus.current) event.preventDefault();
        }}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

function ContactMentionDetails({
  id,
  workspaceId,
  active,
  accessible,
}: {
  id: string;
  workspaceId: string | undefined;
  active: boolean;
  accessible: boolean;
}) {
  const t = useTranslations("Components.ContactMention");
  const detail = useQuery({
    queryKey: [...contactKey(id), workspaceId],
    queryFn: () => contactsService.get(id),
    enabled: active,
    retry: false,
  });
  // A disabled query can still return cached data from another workspace.
  const record = active && !detail.isError ? detail.data : null;
  const contact = record?.mergedIntoId ? null : record;
  const openId =
    record?.mergedIntoId ?? (record || (accessible && !active) ? id : null);
  let status: "unavailable" | "otherWorkspace" | "loading" | "merged" =
    "unavailable";
  if (active && detail.isPending) status = "loading";
  else if (!active && accessible) status = "otherWorkspace";
  else if (record?.mergedIntoId) status = "merged";
  const emails = contact?.channels.filter(
    (channel) => channel.type === "EMAIL",
  );
  const email = (emails?.find((channel) => channel.isPrimary) ?? emails?.[0])
    ?.value;
  return (
    <>
      {contact ? (
        <div className="flex items-start gap-3">
          <ContactRound
            aria-hidden="true"
            className="text-muted-foreground mt-0.5 size-5 shrink-0"
          />
          <div className="min-w-0 space-y-1">
            <p className="text-foreground wrap-anywhere text-sm font-semibold">
              {contact.name}
            </p>
            {contact.role || contact.organization ? (
              <p className="text-muted-foreground wrap-anywhere text-sm">
                {[contact.role, contact.organization]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            ) : null}
            {email ? (
              <p className="text-muted-foreground wrap-anywhere text-sm">
                {email}
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <p role="status" className="text-muted-foreground text-sm">
          {t(status)}
        </p>
      )}
      {workspaceId && openId ? (
        <Link
          href={contactDetailHref(openId, workspaceId)}
          className="text-foreground inline-flex text-sm font-medium underline underline-offset-4"
        >
          {t("open")}
        </Link>
      ) : null}
    </>
  );
}
