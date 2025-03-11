import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { dummyAgents } from "@/data/agents";

import AgentSummary from "./components/agent-details";

export default async function Page({
  params,
}: {
  params: Promise<{ agent: string }>;
}) {
  const { agent } = await params;
  const dummyAgent = dummyAgents.find((a) => a.id === agent)!;

  const t = await getTranslations("Landing.Gallery.Agent");

  return (
    <div className="container mx-auto px-4 pb-8">
      {/* Agent Summary */}
      <div className="space-y-4">
        <AgentSummary {...dummyAgent} />
        <div className="flex gap-4 overflow-x-auto pb-4">
          {Array.from({ length: dummyAgent.examples ?? 0 }).map((_, i) => (
            <Image
              key={i}
              src="/placeholder.svg"
              alt={`Placeholder ${i + 1}`}
              className="h-64 w-auto flex-shrink-0 rounded-lg object-cover"
              width={256}
              height={256}
              priority
            />
          ))}
        </div>
        {/* Developer Information */}
        <div className="text-muted-foreground flex gap-6 text-sm">
          {dummyAgent.legal && <p>{t("Legal.fromDeveloper")}</p>}
          {dummyAgent.legal?.privacyPolicy && (
            <Link
              href={dummyAgent.legal.privacyPolicy}
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              {t("Legal.privacyPolicy")}
            </Link>
          )}
          {dummyAgent.legal?.terms && (
            <Link
              href={dummyAgent.legal.terms}
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              {t("Legal.terms")}
            </Link>
          )}
          {dummyAgent.legal?.other && (
            <Link
              href={dummyAgent.legal.other}
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              {t("Legal.other")}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
