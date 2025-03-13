import { PrismaClient } from "@prisma/client";
import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { AgentDTO } from "@/lib/agent/AgentDTO";

import AgentSummary from "./components/agent-details";

export default async function Page({
  params,
}: {
  params: Promise<{ agent: string }>;
}) {
  const { agent } = await params;
  const prisma = new PrismaClient();
  const _agent = await prisma.agent.findUnique({
    where: {
      id: agent,
    },
    include: {
      Pricing: {
        include: { FixedPricing: { include: { Amounts: true } } },
      },
      ExampleOutput: true,
      ExampleOutputOverride: true,
      Rating: true,
      UserAgentRating: true,
    },
  });
  if (!_agent) {
    throw new Error("Agent not found");
  }
  const agentDTO = new AgentDTO(_agent);

  const t = await getTranslations("Landing.Gallery.Agent");

  return (
    <div className="container mx-auto px-4 pb-8">
      {/* Agent Summary */}
      <div className="space-y-4">
        <AgentSummary
          name={agentDTO.name}
          description={agentDTO.description ?? ""}
          author={agentDTO.Author.name}
          image={agentDTO.image}
          credits={agentDTO.Pricing.credits}
          tags={agentDTO.tags}
        />
        <div className="flex gap-4 overflow-x-auto pb-4">
          {agentDTO.ExampleOutput.map((_, index) => (
            <Image
              key={index}
              src="/placeholder.svg"
              alt={`Placeholder ${index + 1}`}
              className="h-64 w-auto flex-shrink-0 rounded-lg object-cover"
              width={256}
              height={256}
              priority
            />
          ))}
        </div>
        {/* Developer Information */}
        <div className="text-muted-foreground flex gap-6 text-sm">
          {agentDTO.Legal && <p>{t("Legal.fromDeveloper")}</p>}
          {agentDTO.Legal?.privacyPolicy && (
            <Link
              href={agentDTO.Legal.privacyPolicy}
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              {t("Legal.privacyPolicy")}
            </Link>
          )}
          {agentDTO.Legal?.terms && (
            <Link
              href={agentDTO.Legal.terms}
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              {t("Legal.terms")}
            </Link>
          )}
          {agentDTO.Legal?.other && (
            <Link
              href={agentDTO.Legal.other}
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
