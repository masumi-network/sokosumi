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
        "rounded-4xl bg-black px-6 py-3 font-medium text-white uppercase transition-colors hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200",
        className,
      )}
      asChild
    >
      <Link href="/register">{"Register Now & Get 100$ free credits"}</Link>
    </Button>
  );
}
