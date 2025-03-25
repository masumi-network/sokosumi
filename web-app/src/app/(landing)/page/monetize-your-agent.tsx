import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  GitHubButton,
  MasumiButton,
} from "@/app/(landing)/components/social-button";
import { KodosumiLogo, MasumiLogo } from "@/components/masumi-logos";
import { envConfig } from "@/config/env.config";

export function MonetizeYourAgent() {
  const t = useTranslations("Landing.Page.MonetizeYourAgent");
  return (
    <div className="container py-4">
      <div className="flex flex-col items-center gap-8 md:flex-row">
        {/* Content Section */}
        <div className="w-full space-y-6 md:w-1/2">
          <h2 className="text-5xl font-bold tracking-tighter">
            {t("subtitle")}
          </h2>
          <p className="text-muted-foreground text-lg">{t("description")}</p>

          {/* Masumi Logos */}
          <div className="flex flex-col items-end gap-6">
            <Link href={envConfig.KODOSUMI_URL}>
              <KodosumiLogo width={418} height={56} />
            </Link>
            <Link href={envConfig.MASUMI_URL}>
              <MasumiLogo width={371} height={57} />
            </Link>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center justify-end gap-4">
            <MasumiButton />
            <GitHubButton url="https://github.com/masumi-network/masumi-payment-service">
              Masumi Payment
            </GitHubButton>
            <GitHubButton url="https://github.com/masumi-network/masumi-registry-service">
              Masumi Registry
            </GitHubButton>
          </div>
        </div>

        {/* Image Section */}
        <div className="w-full md:w-1/2">
          <div className="relative mx-auto aspect-square w-full max-w-md">
            <Image
              src="/placeholder.svg"
              alt="Community Placeholder"
              fill
              className="rounded-lg object-cover"
              priority
            />
          </div>
        </div>
      </div>
    </div>
  );
}
