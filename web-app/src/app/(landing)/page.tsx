import { useTranslations } from "next-intl";

import AgentsGallery from "./components/agents-gallery";
import Hero from "./components/hero";
import HowItWorks from "./components/how-it-works";
import { JoinOurCommunity } from "./components/join-our-community";
import { MonetizeYourAgent } from "./components/monetize-your-agent";
import NumberTalks from "./components/number-talks";
import Section from "./components/section";

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
