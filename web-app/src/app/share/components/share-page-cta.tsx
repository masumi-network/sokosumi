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

      <div className="relative px-6 py-12 text-center text-white md:px-12 md:py-16">
        <h2 className="mb-4 text-2xl font-bold md:text-3xl lg:text-4xl">
          {t("title")}
        </h2>
        <p className="mb-8 text-lg opacity-90 md:text-xl">{t("description")}</p>
        <Button asChild size="lg" variant="primary" className="gap-2">
          <Link href="https://www.sokosumi.com/agents">
            {t("buttonText")}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
