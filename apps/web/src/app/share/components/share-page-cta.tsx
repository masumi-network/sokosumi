import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SharePageCTAProps {
  className?: string;
}

export default function SharePageCTA({ className }: SharePageCTAProps) {
  const t = useTranslations("Share.CTA");

  return (
    <div className={cn("relative overflow-hidden rounded-lg", className)}>
      <div className="absolute inset-0">
        <Image
          src="/images/backgrounds/share-cta-background.png"
          alt=""
          fill
          className="object-cover"
          priority={false}
        />
        <div className="absolute inset-0 bg-black/20" />
      </div>

      <div className="relative flex flex-col items-start justify-between px-6 py-12 text-black md:flex-row md:items-end md:px-12 md:py-16">
        <div className="mb-8 md:mb-0">
          <h2 className="font-regular mb-2 text-3xl">{t("title")}</h2>
          <p className="text-lg font-light opacity-90">{t("description")}</p>
        </div>
        <Button
          asChild
          size="lg"
          className="shrink-0 gap-8 bg-black px-8 text-white hover:bg-black/90"
        >
          <Link href="https://www.sokosumi.com/agents">
            {t("buttonText")}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
