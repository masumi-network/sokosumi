import Link from "next/link";
import { useTranslations } from "next-intl";
import { FaDiscord, FaXTwitter } from "react-icons/fa6";

import { Button } from "@/components/ui/button";

export function JoinOurCommunity() {
  const t = useTranslations("Landing.Page.JoinOurCommunity");

  return (
    <div className="relative overflow-hidden rounded-lg">
      <div className="opacity landing-join-our-community-bg absolute inset-0" />
      <div className="bg-background/40 dark:bg-background/40 relative px-6 py-12 sm:px-12 sm:py-16">
        <div className="mx-auto max-w-2xl text-center">
          <p className="mb-2 text-xs tracking-wider uppercase">
            {t("subtitle")}
          </p>
          <h2 className="mb-8 text-2xl font-light sm:text-4xl md:text-5xl">
            {t("title")}
          </h2>
          <div className="flex flex-wrap items-center justify-center gap-1.5 md:gap-4">
            <Button asChild>
              <Link
                href="https://discord.com/invite/aj4QfnTS92"
                target="_blank"
                rel="noopener noreferrer"
              >
                <FaDiscord />
                <span>{"Discord"}</span>
              </Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link
                href="https://x.com/MasumiNetwork"
                target="_blank"
                rel="noopener noreferrer"
              >
                <FaXTwitter />
                <span>{"X/Twitter"}</span>
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
