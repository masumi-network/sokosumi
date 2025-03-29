import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { LandingRoute } from "@/types/routes";

export default function BackToGallery() {
  const t = useTranslations("App.Gallery.AgentDetail");

  return (
    <div className="flex items-center gap-4">
      <Link href={LandingRoute.Agents}>
        <Button size="icon" className="h-8 w-8 sm:h-12 sm:w-12">
          <ArrowLeft />
        </Button>
      </Link>
      <h3 className="text-xl font-bold sm:text-2xl">{t("backToGallery")}</h3>
    </div>
  );
}
