import { Gift } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

export function FreeCreditsBanner() {
  const t = useTranslations("Landing.Page.FreeCreditsBanner");
  return (
    <div
      className="border-primary from-primary/10 via-background/70 to-primary/5 group relative mt-4 flex w-full max-w-xs flex-col items-center gap-3 rounded-2xl border-2 bg-gradient-to-br px-8 py-6 shadow-xl transition-transform duration-200 will-change-transform focus-within:scale-[1.025] hover:scale-[1.025] md:max-w-md"
      role="region"
      aria-label={t("title")}
      tabIndex={-1}
    >
      {/* Decorative Icon */}
      <span className="bg-primary shadow-primary/30 absolute -top-6 left-1/2 flex -translate-x-1/2 items-center justify-center rounded-full p-2 shadow-lg">
        <Gift className="text-primary-foreground h-7 w-7" aria-hidden="true" />
      </span>
      <span className="text-primary dark:text-primary-foreground mt-4 flex items-center gap-2 text-base font-semibold md:text-lg">
        {t("title")}
      </span>
      <Button asChild variant="primary" size="lg">
        <Link
          href="/register"
          tabIndex={0}
          aria-label={t("button") + " – " + t("title")}
          className="w-full max-w-xs"
        >
          {t("button")}
        </Link>
      </Button>
    </div>
  );
}
