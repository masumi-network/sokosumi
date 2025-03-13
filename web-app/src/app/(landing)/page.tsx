import { PrismaClient } from "@prisma/client";
import { useTranslations } from "next-intl";
import { Suspense } from "react";

import AgentCard, { AgentCardSkeleton } from "@/components/agent-card";
import { AgentDTO } from "@/lib/agent/AgentDTO";

import HorizontalScroll from "./components/horizontal-scroll";
import Section from "./components/section";
import Hero from "./page/hero";
import HowItWorks from "./page/how-it-works";
import { JoinOurCommunity } from "./page/join-our-community";
import { MonetizeYourAgent } from "./page/monetize-your-agent";
import NumberTalks from "./page/number-talks";

export default function LandingPage() {
  const t = useTranslations("Landing");
  return (
    <>
      {/* Hero Section */}
      <section className="relative overflow-hidden py-20">
        <div className="container px-4 md:px-6">
          <Hero />
        </div>
      </section>

      {/* Agent Gallery Section */}
      <section id="agents-gallery" className="py-12">
        <AgentsGallery />
      </section>

      {/* Number of Talks Section */}
      <section id="number-talks" className="py-12">
        <Section title={t("Page.NumberTalks.title")} fullWidth>
          <NumberTalks />
        </Section>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-12">
        <Section title={t("Page.HowItWorks.title")}>
          <HowItWorks />
        </Section>
      </section>

      {/* Join Our Community Section */}
      <section id="join-our-community" className="py-12">
        <Section title={t("Page.JoinOurCommunity.title")}>
          <JoinOurCommunity />
        </Section>
      </section>

      {/* Monetize Your Agent Section */}
      <section id="monetize" className="py-12">
        <Section title={t("Page.MonetizeYourAgent.title")}>
          <MonetizeYourAgent />
        </Section>
      </section>
    </>
  );
}

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function AgentsList() {
  const prisma = new PrismaClient();
  // Add 5 second delay for debugging
  await delay(5000);

  const agents = await prisma.agent.findMany({
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
  if (!agents) {
    throw new Error("Agent not found");
  }

  const agentsDTO = agents.map((agent) => new AgentDTO(agent));
  return (
    <HorizontalScroll itemClassName="h-[32rem] w-[24rem]">
      {agentsDTO.map((agent) => (
        <AgentCard
          key={agent.id}
          id={agent.id}
          name={agent.name}
          description={agent.description ?? ""}
          averageStars={agent.Rating.averageStars}
          image={agent.image}
          price={agent.Pricing.credits}
          tags={agent.tags}
        />
      ))}
    </HorizontalScroll>
  );
}

function AgentsGallerySkeleton() {
  return (
    <HorizontalScroll itemClassName="h-[32rem] w-[24rem]">
      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
        <AgentCardSkeleton key={i} />
      ))}
    </HorizontalScroll>
  );
}

function AgentsGallery() {
  return (
    <Suspense fallback={<AgentsGallerySkeleton />}>
      <AgentsList />
    </Suspense>
  );
}
