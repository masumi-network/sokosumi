import Link from "next/link";

import { SignUpButton } from "@/auth/components/buttons";
import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import { cn } from "@/lib/utils";

interface HeaderProps {
  className?: string | undefined;
}

export default function Header({ className }: HeaderProps) {
  return (
    <header
      className={cn(
        "border-grid bg-background/95 fixed top-0 z-50 flex w-full justify-between gap-2 border-b md:sticky md:items-center",
        className,
      )}
    >
      <div className="flex w-full items-center justify-between gap-2 p-2 md:w-auto">
        <Link href="/">
          <ThemedLogo
            LogoComponent={SokosumiLogo}
            priority
            width={123}
            height={16}
          />
        </Link>
      </div>

      <div>
        <SignUpButton />
      </div>
    </header>
  );
}
