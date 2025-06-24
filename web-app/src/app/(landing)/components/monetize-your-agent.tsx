import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

export function MonetizeYourAgent() {
  const t = useTranslations("Landing.Page.MonetizeYourAgent");

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-0">
      <div className="lg:pr-12">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg drop-shadow-lg">
          <Image
            src="/backgrounds/visuals/ink-areal-3.png"
            alt="Abstract green gradient"
            fill
            className="object-cover"
            priority
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
          />
        </div>
      </div>
      <div className="border-muted-foreground/10 flex h-full flex-col justify-center space-y-6 border-l lg:pl-12">
        <div className="space-y-2">
          <p className="text-muted-foreground text-xs font-medium tracking-wider uppercase md:text-sm">
            {t("title")}
          </p>
          <h2 className="text-2xl font-light md:text-5xl">{t("subtitle")}</h2>
        </div>
        <p className="text-muted-foreground text-sm md:text-base">
          {t("description")}
        </p>
        <div className="flex flex-wrap gap-1.5 md:gap-4">
          <Button asChild>
            <Link
              href="https://docs.masumi.network/"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("docs")}
            </Link>
          </Button>
          <Button asChild variant="secondary">
            <Link
              href="https://masumi.network"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("visit")}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
