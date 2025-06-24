import { useTranslations } from "next-intl";
import Marquee from "react-fast-marquee";

import { ThemedImage } from "@/components/ui/themed-image";

interface Logo {
  key: string;
  srcLight: string;
  srcDark: string;
  alt: string;
  width: number;
  height: number;
}

export default function Endorsements() {
  const t = useTranslations("Landing.Page.Endorsements");
  const logos: Logo[] = [
    {
      key: "house-of-communication",
      srcLight: "/endorsement/house-of-communication-black.svg",
      srcDark: "/endorsement/house-of-communication-white.svg",
      alt: "House of Communication",
      width: 385,
      height: 40,
    },
    {
      key: "cardano-foundation",
      srcLight: "/endorsement/cardano-black.svg",
      srcDark: "/endorsement/cardano-white.svg",
      alt: "Cardano Foundation",
      width: 72,
      height: 64,
    },
    {
      key: "nmkr",
      srcLight: "/endorsement/nmkr-black.svg",
      srcDark: "/endorsement/nmkr-white.svg",
      alt: "Nmkr",
      width: 220,
      height: 40,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-foreground text-sm font-normal tracking-wider uppercase">
        {t("title")}
      </h2>

      <Marquee direction="left" pauseOnHover={false}>
        {logos.map((logo) => (
          <div key={logo.key} className="mx-10 my-4 xl:mx-16">
            <ThemedImage
              srcLight={logo.srcLight}
              srcDark={logo.srcDark}
              alt={logo.alt}
              width={logo.width}
              height={logo.height}
              style={{
                display: "inline-block",
                width: logo.width,
                height: logo.height,
              }}
            />
          </div>
        ))}
      </Marquee>
    </div>
  );
}
