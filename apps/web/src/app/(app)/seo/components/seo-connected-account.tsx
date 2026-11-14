"use client";

import { ArrowLeftRight, Check, ChevronDown, Unplug } from "lucide-react";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { SEO_GHOST_EDGE_CLASS, SEO_WRAP_CLASS } from "./seo-shared";
import type { SeoConnection } from "./use-seo-connection";

/**
 * A connected account: one quiet line that says so. The two account actions
 * are rare, so they sit in its menu and not beside the step's own action.
 */
export function SeoConnectedAccount({
  name,
  model,
  inRow = false,
}: {
  /** The source's display name, for example "Search Console". */
  name: string;
  model: SeoConnection;
  /** Beside other buttons the line keeps its own box; in a column its icon sits on the edge. */
  inRow?: boolean;
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
            variant="ghost"
            size="sm"
            className={cn(SEO_WRAP_CLASS, !inRow && SEO_GHOST_EDGE_CLASS)}
            loading={busy}
          >
            <Check />
            {t("connections.connected", { provider: name })}
            <ChevronDown className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onSelect={() => {
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
