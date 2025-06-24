"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import useWindowSize from "@/hooks/use-window-size";

export default function AppLayoutRestrictor() {
  const t = useTranslations("Components.AppLayoutRestrictor");

  const { innerWidth } = useWindowSize();
  const showRestrictor = innerWidth < 1024;

  useEffect(() => {
    document.body.style.overflow = showRestrictor ? "hidden" : "auto";

    return () => {
      document.body.style.overflow = "auto"; // Reset overflow to auto when component unmounts
    };
  }, [showRestrictor]);

  if (!showRestrictor) {
    return null;
  }

  return (
    <div className="bg-background fixed top-0 left-0 z-[999999] flex h-svh w-svw items-center justify-center rounded-none p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center justify-center gap-2 text-center">
          <h1 className="text-xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
        <Button onClick={() => window.location.reload()} size="sm">
          {t("reload")}
        </Button>
      </div>
    </div>
  );
}
