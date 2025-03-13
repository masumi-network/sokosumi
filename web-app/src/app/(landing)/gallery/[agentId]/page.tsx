import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AgentDTO } from "@/lib/db/dto/AgentDTO";
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
  let agent: AgentDTO;
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
          name={agent.name}
          description={agent.description ?? ""}
          author={agent.Author.name}
          image={agent.image}
          credits={agent.Pricing.credits}
          tags={agent.tags}
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
          {agent.Legal && <p>{t("Legal.fromDeveloper")}</p>}
          {agent.Legal?.privacyPolicy && (
            <Link
              href={agent.Legal.privacyPolicy}
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              {t("Legal.privacyPolicy")}
            </Link>
          )}
          {agent.Legal?.terms && (
            <Link
              href={agent.Legal.terms}
              className="hover:text-foreground underline underline-offset-4 transition-colors"
            >
              {t("Legal.terms")}
            </Link>
          )}
          {agent.Legal?.other && (
            <Link
              href={agent.Legal.other}
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
