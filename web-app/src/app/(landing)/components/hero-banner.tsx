import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HeroBannerProps {
  className?: string;
}

export function HeroBanner({ className }: HeroBannerProps) {
  const t = useTranslations("Landing.Page.Hero.HeroBanner");

  return (
    <Button
      className={cn(
        "text-background bg-foreground rounded-3xl px-6 py-3 font-medium uppercase transition-all hover:opacity-80",
        className,
      )}
      asChild
    >
      <Link href="/register">{t("button")}</Link>
    </Button>
  );
}
