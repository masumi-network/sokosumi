import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

export function MonetizeYourAgent() {
  const t = useTranslations("Landing.Page.MonetizeYourAgent");

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="py-24">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg drop-shadow-lg">
          <Image
            src="/backgrounds/monetize-your-agent.png"
            alt="Abstract green gradient"
            fill
            className="object-cover"
            priority
          />
        </div>
      </div>
      <div className="border-muted-foreground/10 flex h-full flex-col justify-center space-y-6 border-l px-12">
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm font-medium tracking-wider uppercase">
            {t("title")}
          </p>
          <h2 className="text-5xl font-light">{t("subtitle")}</h2>
        </div>
        <p className="text-muted-foreground">{t("description")}</p>
        <div className="flex flex-wrap gap-4">
          <Button asChild variant="default">
            <Link
              href="https://docs.masumi.network/"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("docs")}
            </Link>
          </Button>
          <Button
            asChild
            className="bg-quarterny text-foreground hover:bg-quarterny/90"
          >
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
