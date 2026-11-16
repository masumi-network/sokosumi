"use client";

import { ArrowLeftRight, ChevronDown, Unplug } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SEO_WRAP_CLASS } from "./seo-shared";
import type { SeoConnection } from "./use-seo-connection";

/**
 * A connected account: one chip with a green mark that says so. A press opens
 * its menu, which names what the account reads and holds the two rare
 * account actions, so they do not sit beside the step's own action.
 */
export function SeoConnectedAccount({
  name,
  model,
  compact = false,
  detail,
}: {
  /** The source's display name, for example "Search Console". */
  name: string;
  model: SeoConnection;
  /** The source's name is already in view: the chip says only "Connected". */
  compact?: boolean;
  /** What this account reads here, for example the property. The menu names it. */
  detail?: string;
}) {
  const t = useTranslations("App.Seo");
  const [menu, setMenu] = useState(false);
  const [asking, setAsking] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const busy = model.busy !== null;
  return (
    <>
      <DropdownMenu
        open={menu && !busy}
        // A press during a change must not open the menu when the change ends.
        onOpenChange={(open) => setMenu(open && !busy)}
      >
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="default"
            size="sm"
            className={SEO_WRAP_CLASS}
            loading={busy}
            // The short text is not unique in a list of sources: the name says which one.
            aria-label={
              compact
                ? t("connections.connected", { provider: name })
                : undefined
            }
          >
            {/* The text says the state too: the colour is never the only sign. */}
            <span
              aria-hidden
              className="bg-semantic-success size-2 shrink-0 rounded-full"
            />
            {compact
              ? t("connections.connectedShort")
              : t("connections.connected", { provider: name })}
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align={compact ? "end" : "start"}
          className="max-w-80"
        >
          <DropdownMenuLabel className="space-y-0.5 font-normal">
            <span className="block font-medium">
              {t("connections.connected", { provider: name })}
            </span>
            <span className="text-muted-foreground block break-words">
              {detail
                ? t("connections.reads", { detail })
                : t("connections.viaGoogle")}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              // The menu closes now: it must not open again when the switch ends.
              setMenu(false);
              void model.connect();
            }}
          >
            <ArrowLeftRight />
            {t("connections.changeAccount")}
          </DropdownMenuItem>
          {/* One press must not remove the account: the reader confirms first. */}
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setAsking(true)}
          >
            <Unplug />
            {t("connections.disconnectAccount")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent
          // The menu item that opened the question is gone: focus returns to the line.
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("connections.disconnectTitle", { provider: name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("connections.disconnectBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void model.disconnect();
              }}
            >
              {t("connections.disconnect", { provider: name })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
