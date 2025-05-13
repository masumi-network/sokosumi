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
      key: "lufthansa",
      srcLight: "/endorsement/lufthansa-black.svg",
      srcDark: "/endorsement/lufthansa-white.svg",
      alt: "Lufthansa",
      width: 64,
      height: 64,
    },
    {
      key: "bvg",
      srcLight: "/endorsement/bvg-black.svg",
      srcDark: "/endorsement/bvg-white.svg",
      alt: "BVG",
      width: 72,
      height: 64,
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
    <div className="w-full">
      <h2 className="text-foreground mb-12 text-sm font-semibold tracking-wider uppercase">
        {t("title")}
      </h2>

      <div className={`w-full pt-10`}>
        <Marquee direction="left" pauseOnHover={false}>
          {logos.map((logo) => (
            <div key={logo.key} className="mx-10 xl:mx-16">
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
    </div>
  );
}
