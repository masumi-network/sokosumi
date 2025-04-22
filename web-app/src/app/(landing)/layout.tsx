import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { KanjiLogo, ThemedLogo } from "@/components/masumi-logos";

import Footer from "./components/footer";
import Header from "./components/header";

interface LandingLayoutProps {
  children: React.ReactNode;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Landing.Metadata");

  return {
    title: {
      default: t("Title.default"),
      template: t("Title.template"),
    },
    description: t("description"),
  };
}

export default function LandingLayout({ children }: LandingLayoutProps) {
  return (
    <div className="flex min-h-svh flex-col">
      <Header />
      <main className="flex-1 pt-24">{children}</main>
      <Kanji />
      <Footer />
    </div>
  );
}

function Kanji() {
  return (
    <div className="pointer-events-none fixed right-0 z-0 flex h-full w-full items-center justify-end p-12">
      <ThemedLogo LogoComponent={KanjiLogo} />
    </div>
  );
}
