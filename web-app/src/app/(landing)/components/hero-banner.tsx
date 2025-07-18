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
        "text-background bg-foreground rounded-3xl px-6 py-3 font-medium uppercase transition-all hover:opacity-80",
        className,
      )}
      asChild
    >
      <Link href="/register">{"Register Now & Get $100 free credits"}</Link>
    </Button>
  );
}
