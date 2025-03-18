import { Menu } from "lucide-react";
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

import AuthButtons from "./auth-buttons";
import NavigationMenu from "./navigation-menu";

export default function SheetNavigation() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon">
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent className="h-svh w-full max-w-sm p-4" side="right">
        <SheetHeader>
          <SheetTitle className="flex justify-center">
            <Link href="/">
              <SokosumiLogo width={200} height={26} />
            </Link>
          </SheetTitle>
          <SheetDescription />
        </SheetHeader>
        <nav className="mt-4">
          <AuthButtons containerClassName="flex items-center justify-around" />
          <NavigationMenu className="mt-8 flex-col gap-4 text-base" />
        </nav>
      </SheetContent>
    </Sheet>
  );
}
