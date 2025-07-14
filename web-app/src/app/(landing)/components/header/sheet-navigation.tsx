import { Menu, X } from "lucide-react";
import Link from "next/link";

import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import AppConnection from "./app-connection";
import NavigationMenu from "./navigation-menu";

export default function SheetNavigation() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <div className="mx-2 flex flex-1 justify-end md:hidden">
          <Menu size={24} />
        </div>
      </SheetTrigger>
      <SheetContent
        className="bg-material-thin flex h-svh min-w-svw flex-col p-4 backdrop-blur-3xl [&>button]:hidden"
        side="right"
      >
        <SheetHeader className="p-0">
          <SheetTitle className="flex items-center justify-between">
            <SheetClose asChild>
              <Link href="/">
                <ThemedLogo LogoComponent={SokosumiLogo} priority />
              </Link>
            </SheetClose>
            <SheetClose asChild>
              <X size={24} />
            </SheetClose>
          </SheetTitle>
          <SheetDescription />
        </SheetHeader>
        <nav className="flex flex-1 flex-col items-center justify-center">
          <NavigationMenu
            className="flex-col gap-4 text-center text-sm font-medium"
            NavigationLinkWrapper={({ children }) => (
              <SheetClose asChild>{children}</SheetClose>
            )}
          />
        </nav>
        <AppConnection className="w-full" />
      </SheetContent>
    </Sheet>
  );
}
