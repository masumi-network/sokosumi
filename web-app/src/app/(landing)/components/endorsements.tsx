import Image from "next/image";
import { useTranslations } from "next-intl";

import styles from "./endorsements.module.css";

export default function Endorsements() {
  const t = useTranslations("Landing.Page.Endorsements");
  const logos = [
    <Image
      key="bvg"
      src="/endorsement/lufthansa-white.svg"
      alt="Lufthansa"
      width={64}
      height={64}
      style={{ display: "inline-block" }}
    />,
    <Image
      key="bvg"
      src="/endorsement/bvg-white.svg"
      alt="BVG"
      width={72}
      height={64}
      style={{ display: "inline-block" }}
    />,
    <Image
      key="cardano-foundation"
      src="/endorsement/cardano-white.svg"
      alt="Cardano Foundation"
      width={72}
      height={64}
      style={{ display: "inline-block" }}
    />,
    <Image
      key="house-of-communication"
      src="/endorsement/house-of-communication-white.svg"
      alt="House of Communication"
      width={617}
      height={64}
      style={{ display: "inline-block" }}
    />,
    <Image
      key="nmkr"
      src="/endorsement/nmkr-white.svg"
      alt="Nmkr"
      width={352}
      height={64}
      style={{ display: "inline-block" }}
    />,
  ];

  return (
    <div className="w-full">
      <h2 className="text-foreground mb-12 text-sm font-semibold tracking-wider uppercase">
        {t("title")}
      </h2>
      <div className={`w-full py-10 ${styles.marqueeContainer}`}>
        <div className={styles.marqueeContent}>
          {logos.map((logo, index) => (
            <div key={`logo-${index}`} className={styles.logoWrapper}>
              {logo}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
