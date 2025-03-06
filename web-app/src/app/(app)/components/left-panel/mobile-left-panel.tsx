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

import AgentAddButton from "./components/agent-add-button";
import AgentsList from "./components/agents-list";

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
        <div className="flex h-full flex-col">
          <AgentsList className="mt-2 bg-background" />
          <AgentAddButton className="bg-background" />
        </div>
      </SheetContent>
    </Sheet>
  );
}
