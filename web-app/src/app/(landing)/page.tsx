import { Loader, TrendingDown, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";

import AgentCard from "@/components/agent-card";
import IconTitleDescription from "@/components/icon-title-description";
import { dummyAgents } from "@/data/agents";

import HorizontalScroll from "./components/horizontal-scroll";
import HowItWorks from "./how-it-works";
import { JoinOurCommunity } from "./join-our-community";
import { MonetizeYourAgent } from "./monetize-your-agent";

export default function LandingPage() {
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
        <div className="px-4 md:px-6">
          <NumberTalks />
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-12">
        <div className="container px-4 md:px-6">
          <h2 className="mb-6 text-3xl font-bold tracking-tighter">
            How It Works
          </h2>
        </div>
        <div className="container mx-auto px-4 md:px-6">
          <HowItWorks />
        </div>
      </section>

      {/* Join Our Community Section */}
      <section id="join-our-community" className="py-12">
        <div className="container px-4 md:px-6">
          <h2 className="mb-6 text-3xl font-bold tracking-tighter">
            Join Our Community
          </h2>
        </div>
        <JoinOurCommunity />
      </section>

      {/* Monetize Your Agent Section */}
      <section id="monetize" className="py-12">
        <div className="container px-4 md:px-6">
          <h2 className="mb-6 text-3xl font-bold tracking-tighter">
            Monetize Your Agents
          </h2>
          <MonetizeYourAgent />
        </div>
      </section>
    </>
  );
}

function Hero() {
  const t = useTranslations("Landing.Hero");
  return (
    <>
      <div className="flex flex-col items-center space-y-4 text-center">
        <div className="space-y-6">
          {/* First text box */}
          <div className="w-full">
            <p className="text-5xl leading-tight font-normal text-slate-500 md:whitespace-pre-line">
              {t("caption")}
            </p>
          </div>

          {/* Second text box */}
          <div className="w-full">
            <p className="text-6xl font-bold">{t("title")}</p>
          </div>
        </div>
      </div>
    </>
  );
}

function AgentsGallery() {
  return (
    <HorizontalScroll>
      {dummyAgents.map((agent, index) => (
        <AgentCard key={index} agent={agent} />
      ))}
    </HorizontalScroll>
  );
}

function NumberTalks() {
  return (
    <>
      <div className="container px-4 md:px-6">
        <h2 className="mb-6 text-3xl font-bold tracking-tighter">
          Number Talks
        </h2>
      </div>
      <HorizontalScroll>
        <IconTitleDescription
          icon={Loader}
          title="2 hours"
          description="to complete a full team report something something something"
        />
        <IconTitleDescription
          icon={TrendingDown}
          title="42% less costs"
          description="of something something because something"
        />
        <IconTitleDescription
          icon={TrendingUp}
          title="69% more free time"
          description="because team is not something something too much"
        />
      </HorizontalScroll>
    </>
  );
}
