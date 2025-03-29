import { ArrowLeftFromLine } from "lucide-react";
import Link from "next/link";

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
import { AppRoute } from "@/types/routes";

import NavigationMenu from "./navigation-menu";

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
      <SheetContent className="h-svh w-full max-w-sm p-4" side="right">
        <SheetHeader>
          <SheetTitle className="flex justify-center">
            <Link href={AppRoute.Home}>
              <SokosumiLogo width={200} height={26} />
            </Link>
          </SheetTitle>
          <SheetDescription />
        </SheetHeader>
        <nav className="mt-4">
          <NavigationMenu className="flex-col gap-4 text-base" />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
