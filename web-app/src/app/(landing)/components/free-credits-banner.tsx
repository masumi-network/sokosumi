import { Gift } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

export function FreeCreditsBanner() {
  const t = useTranslations("Landing.Page.FreeCreditsBanner");
  return (
    <div
      className="border-primary from-primary/10 via-background to-primary/5 group relative mt-4 flex w-full max-w-md flex-col items-center gap-3 rounded-2xl border-2 bg-gradient-to-br px-8 py-6 shadow-xl transition-transform duration-200 focus-within:scale-[1.025] hover:scale-[1.025]"
      role="region"
      aria-label={t("title")}
      tabIndex={-1}
    >
      {/* Decorative Icon */}
      <span className="bg-primary shadow-primary/30 absolute -top-6 left-1/2 flex -translate-x-1/2 items-center justify-center rounded-full p-2 shadow-lg">
        <Gift className="text-primary-foreground h-7 w-7" aria-hidden="true" />
      </span>
      <span className="text-primary mt-4 flex items-center gap-2 text-lg font-semibold">
        {t("title")}
      </span>
      <a
        href="/auth/sign-up"
        tabIndex={0}
        aria-label={t("button") + " – " + t("title")}
        className="w-full max-w-xs"
      >
        <Button
          variant="primary"
          size="lg"
          className="shadow-primary/30 hover:shadow-primary/50 mt-2 w-full max-w-xs shadow-md transition-shadow duration-200 hover:shadow-lg"
        >
          {t("button")}
        </Button>
      </a>
    </div>
  );
}
