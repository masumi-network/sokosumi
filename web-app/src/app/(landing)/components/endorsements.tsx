import { FaMicrosoft } from "react-icons/fa";
import { SiBmw, SiBosch, SiLufthansa } from "react-icons/si";

import styles from "./endorsements.module.css";

export default function Endorsements() {
  const logos = [
    <SiBmw key="bmw1" size={64} />,
    <SiBmw key="bmw2" size={64} />,
    <SiBmw key="bmw3" size={64} />,
    <SiLufthansa key="lufthansa1" size={64} />,
    <SiBosch key="bosch1" size={64} />,
    <FaMicrosoft key="microsoft1" size={64} />,
    <SiBmw key="bmw4" size={64} />,
    <SiBmw key="bmw5" size={64} />,
    <SiLufthansa key="lufthansa2" size={64} />,
    <SiBosch key="bosch2" size={64} />,
    <FaMicrosoft key="microsoft2" size={64} />,
    <SiBmw key="bmw6" size={64} />,
  ];

  return (
    <div className="w-full">
      <h2 className="text-foreground mb-12 text-sm font-semibold tracking-wider">
        {"ENDORSED BY LEADING BRANDS"}
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
          {logos.map((logo, index) => (
            <div key={`logo-copy-${index}`} className={styles.logoWrapper}>
              {logo}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
