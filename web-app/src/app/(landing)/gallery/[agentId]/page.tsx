import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import {
  AgentWithRelations,
  getAuthorName,
  getCredits,
  getDescription,
  getImageUrl,
  getLegalOther,
  getLegalPrivacyPolicy,
  getLegalTerms,
  getName,
  getTags,
} from "@/lib/db/agent/agent-helper";
import { getAgentById, getAgents } from "@/lib/db/services/agent.service";

import Details from "./components/agent-details";

// Next.js will invalidate the cache when a
// request comes in, at most once every 1 hour (3600 seconds).
export const revalidate = 3600;

// We'll prerender only the params from `generateStaticParams` at build time.
// If a request comes in for a path that hasn't been generated,
// Next.js will server-render the page on-demand.
export const dynamicParams = true; // or false, to 404 on unknown paths

export async function generateStaticParams() {
  const agents = await getAgents();
  return agents.map((agent) => ({
    agentId: String(agent.id),
  }));
}

export default async function Page({
  params,
}: {
  params: Promise<{ agentId: string }>;
}) {
  const { agentId } = await params;
  let agent: AgentWithRelations;
  try {
    agent = await getAgentById(agentId);
  } catch {
    notFound();
  }

  const t = await getTranslations("Landing.Gallery.Agent");

  return (
    <div className="container mx-auto px-4 pb-8">
      {/* Agent Summary */}
      <div className="space-y-4">
        <Details
          name={getName(agent)}
          description={getDescription(agent) ?? ""}
          author={getAuthorName(agent)}
          image={getImageUrl(agent)}
          credits={getCredits(agent)}
          tags={getTags(agent)}
        />
        <div className="flex gap-4 overflow-x-auto pb-4">
          {agent.ExampleOutput.map((_, index) => (
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
          {getLegalPrivacyPolicy(agent) && <p>{t("Legal.fromDeveloper")}</p>}
          {getLegalPrivacyPolicy(agent) && (
            <Link
              href={getLegalPrivacyPolicy(agent)!}
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              {t("Legal.privacyPolicy")}
            </Link>
          )}
          {getLegalTerms(agent) && (
            <Link
              href={getLegalTerms(agent)!}
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              {t("Legal.terms")}
            </Link>
          )}
          {getLegalOther(agent) && (
            <Link
              href={getLegalOther(agent)!}
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
