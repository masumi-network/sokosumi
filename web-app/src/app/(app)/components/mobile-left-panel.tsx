"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import { LeftPanelContent } from "./main-left-panel";

export default function MobileLeftPanel() {
  const [open, setOpen] = React.useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <div className="flex-1 md:hidden">
          <Button variant="outline" size="icon">
            {open ? <PanelLeftClose /> : <PanelLeftOpen />}
          </Button>
        </div>
      </SheetTrigger>
      <SheetContent className="h-svh w-full max-w-sm" side="left">
        <SheetHeader>
          <SheetTitle></SheetTitle>
          <SheetDescription></SheetDescription>
        </SheetHeader>
        <LeftPanelContent className="mt-2 bg-background" />
      </SheetContent>
    </Sheet>
  );
}
