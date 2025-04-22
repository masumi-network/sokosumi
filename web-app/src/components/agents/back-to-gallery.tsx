"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

export default function BackToGallery() {
  const t = useTranslations("Components.Agents.AgentDetail");
  const pathname = usePathname();
  const parentPath = pathname.split("/").slice(0, -1).join("/") || "/";

  return (
    <div className="flex items-center gap-4">
      <Link href={parentPath}>
        <Button size="icon" className="h-8 w-8 sm:h-12 sm:w-12">
          <ArrowLeft />
        </Button>
      </Link>
      <h3 className="text-xl font-bold sm:text-2xl">{t("backToGallery")}</h3>
    </div>
  );
}
