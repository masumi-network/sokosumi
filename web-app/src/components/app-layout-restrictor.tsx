"use client";

import { useTranslations } from "next-intl";

import useWindowSize from "@/hooks/use-window-size";

export default function AppLayoutRestrictor() {
  const t = useTranslations("Components.AppLayoutRestrictor");

  const { innerWidth } = useWindowSize();
  const showRestrictor = innerWidth < 1024;

  if (!showRestrictor) {
    return null;
  }

  return (
    <div className="bg-background fixed top-0 left-0 z-[999999] flex h-screen w-screen items-center justify-center rounded-none">
      <div className="flex flex-col items-center justify-center">
        <h1 className="text-2xl font-bold">{t("title")}</h1>
        <p className="text-center">{t("description")}</p>
      </div>
    </div>
  );
}
