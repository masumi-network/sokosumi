import Link from "next/link";
import { useTranslations } from "next-intl";

import { APP_HEADER_SAFE_AREA_PADDING_CLASS } from "@/app/components/app-shell-safe-area";
import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HeaderProps {
  className?: string | undefined;
}

export default function Header({ className }: HeaderProps) {
  const t = useTranslations("Auth.Words");
  return (
    <header
      className={cn(
        "border-grid bg-surface-sticky fixed top-0 z-50 w-full border-b md:sticky md:pl-0 md:pr-0",
        APP_HEADER_SAFE_AREA_PADDING_CLASS,
      )}
    >
      <div
        className={cn(
          "flex h-16 w-full items-center justify-between gap-2 md:items-center",
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
          <Button asChild variant="primary">
            <Link href="/signup">{t("signUp")}</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
