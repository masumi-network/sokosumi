import Link from "next/link";
import { useTranslations } from "next-intl";

import { SokosumiLogo, ThemedLogo } from "@/components/masumi-logos";

export default async function SharedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex h-svh gap-6 p-6">
      <div className="flex h-full flex-1 flex-col gap-6">
        <Link href="/">
          <ThemedLogo LogoComponent={SokosumiLogo} priority />
        </Link>
        <div className="mx-auto flex w-full max-w-md flex-1 items-center justify-center">
          {children}
        </div>
        <SharedLayoutFooter />
      </div>
    </div>
  );
}

function SharedLayoutFooter() {
  const t = useTranslations("Auth.Footer");

  return (
    <div className="flex items-center justify-center gap-4">
      <Link href="/privacy-policy" className="text-sm hover:text-gray-300">
        {t("privacyPolicy")}
      </Link>
      <Link href="/terms-of-service" className="text-sm hover:text-gray-300">
        {t("termsOfServices")}
      </Link>
    </div>
  );
}
