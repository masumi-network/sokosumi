import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { LandingRoute } from "@/types/routes";

export default function HowItWorks() {
  const t = useTranslations("Landing.Page.HowItWorks");
  const keys = ["SelectAndTest", "RunAndMonitor", "GetResults"] as const;
  return (
    <>
      {/* Responsive grid - horizontal on md+ screens, vertical on smaller screens */}
      <div className="mb-10 grid grid-cols-1 gap-8 text-left md:grid-cols-3">
        {/* Iterate over steps from translation file */}
        {keys.map((key) => (
          <div key={key} className="flex h-full w-full flex-col items-start">
            <div className="flex h-full w-full flex-col">
              <h3 className="mb-3 text-xl font-semibold">
                {t(`Steps.${key}.title`)}
              </h3>
              <p className="mb-4 grow text-gray-600">
                {t(`Steps.${key}.description`)}
              </p>
              <div className="relative h-48 w-full overflow-hidden rounded-lg">
                <Image
                  src="/placeholder.svg"
                  alt={`${t(`Steps.${key}.title`)} illustration`}
                  fill
                  className="object-cover"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Explore Gallery Button */}
      <div className="flex justify-start">
        <Link href={LandingRoute.Agents}>
          <Button>{t("button")}</Button>
        </Link>
      </div>
    </>
  );
}
