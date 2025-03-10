import { ArrowLeftFromLine } from "lucide-react";

import { SokosumiLogo } from "@/components/masumi-logos";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import NavMenu from "./nav-menu";

export default function SheetNavigation() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <div className="mx-2 flex flex-1 justify-end md:hidden">
          <Button variant="outline" size="icon">
            <ArrowLeftFromLine />
          </Button>
        </div>
      </SheetTrigger>
      <SheetContent className="h-svh max-w-sm p-4" side="right">
        <SheetHeader>
          <SheetTitle className="flex justify-center">
            <SokosumiLogo />
          </SheetTitle>
          <SheetDescription />
        </SheetHeader>
        <nav className="mt-4">
          <NavMenu className="flex-col gap-4 text-base" />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
