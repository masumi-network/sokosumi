import Image from "next/image";

/**
 * CMO.XYZ's approved wordmark from the Masumi Family Brand Guide
 * (`logos/cmo-xyz/wordmark`), copied unchanged: the black file on a light
 * page, the white one on a dark page. Never recolour either. 16px tall is
 * 124px wide; the guide's minimum is 80px.
 */
export function CmoWordmark() {
  return (
    <>
      <Image
        alt="CMO.xyz"
        className="h-4 w-auto dark:hidden"
        height={106}
        priority
        src="/images/logos/cmo-xyz-dela-black.svg"
        width={820}
      />
      <Image
        alt="CMO.xyz"
        className="hidden h-4 w-auto dark:block"
        height={106}
        priority
        src="/images/logos/cmo-xyz-dela-white.svg"
        width={820}
      />
    </>
  );
}
