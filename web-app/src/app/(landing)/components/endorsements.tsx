import { useTranslations } from "next-intl";

import { ThemedImage } from "@/components/ui/themed-image";

import styles from "./endorsements.module.css";

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
      <div className={`w-full py-10 ${styles.marqueeContainer}`}>
        <div className={styles.marqueeContent}>
          {[...logos, ...logos].map((logo, idx) => (
            <div key={logo.key + "-" + idx} className={styles.logoWrapper}>
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
        </div>
      </div>
    </div>
  );
}
