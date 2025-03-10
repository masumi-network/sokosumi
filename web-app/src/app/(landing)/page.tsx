import AgentCard from "@/components/agent-card";
import { dummyAgents } from "@/data/agents";

import HorizontalScroll from "./components/horizontal-scroll";
import Section from "./components/section";
import Hero from "./hero";
import HowItWorks from "./how-it-works";
import { JoinOurCommunity } from "./join-our-community";
import { MonetizeYourAgent } from "./monetize-your-agent";
import NumberTalks from "./number-talks";

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
        <Section title="Number Talks">
          <NumberTalks />
        </Section>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-12">
        <Section title="How It Works">
          <div className="container mx-auto px-4 md:px-6">
            <HowItWorks />
          </div>
        </Section>
      </section>

      {/* Join Our Community Section */}
      <section id="join-our-community" className="py-12">
        <Section title="Join Our Community">
          <div className="container mx-auto px-4 md:px-6">
            <JoinOurCommunity />
          </div>
        </Section>
      </section>

      {/* Monetize Your Agent Section */}
      <section id="monetize" className="py-12">
        <Section title="Monetize Your Agents">
          <div className="container mx-auto px-4 md:px-6">
            <MonetizeYourAgent />
          </div>
        </Section>
      </section>
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
