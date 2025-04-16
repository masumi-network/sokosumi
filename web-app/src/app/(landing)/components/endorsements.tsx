import { useTranslations } from "next-intl";
import {
  SiAdidas,
  SiAdobe,
  SiAmazon,
  SiApple,
  SiBmw,
  SiBosch,
  SiCardano,
  SiLufthansa,
  SiSamsung,
} from "react-icons/si";

import styles from "./endorsements.module.css";

export default function Endorsements() {
  const t = useTranslations("Landing.Page.Endorsements");
  const logos = [
    <SiAdidas key="adidas" size={64} />,
    <SiBmw key="bmw" size={64} />,
    <SiLufthansa key="lufthansa" size={64} />,
    <SiBosch key="bosch" size={64} />,
    <SiApple key="apple" size={64} />,
    <SiSamsung key="samsung" size={64} />,
    <SiAdobe key="adobe" size={64} />,
    <SiAmazon key="amazon" size={64} />,
    <SiCardano key="cardano" size={64} />,
  ];

  return (
    <div className="w-full">
      <h2 className="text-foreground mb-12 text-sm font-semibold tracking-wider uppercase">
        {t("title")}
      </h2>
      <div className={`w-full py-10 ${styles.marqueeContainer}`}>
        <div className="from-background pointer-events-none absolute top-0 left-0 z-10 h-full w-[200px] bg-gradient-to-r to-transparent"></div>
        <div className="from-background pointer-events-none absolute top-0 right-0 z-10 h-full w-[200px] bg-gradient-to-l to-transparent"></div>
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
