import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HeroBannerProps {
  className?: string;
}

export function HeroBanner({ className }: HeroBannerProps) {
  return (
    <Button
      className={cn(
        "bg-foreground text-background hover:bg-foreground/80 rounded-3xl px-6 py-3 font-medium uppercase transition-colors",
        className,
      )}
      asChild
    >
      <Link href="/register">{"Register Now & Get $100 free credits"}</Link>
    </Button>
  );
}
