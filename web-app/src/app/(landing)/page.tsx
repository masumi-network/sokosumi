import Endorsements from "./components/endorsements";
import FeaturedAgents from "./components/featured-agents";
import Hero from "./components/hero";
import HowItWorks from "./components/how-it-works";
import { JoinOurCommunity } from "./components/join-our-community";
import { MonetizeYourAgent } from "./components/monetize-your-agent";
import NumberTalks from "./components/number-talks";
import Testimonials from "./components/testimonials";

export default function LandingPage() {
  return (
    <>
      {/* Hero Section */}
      <section className="relative -mt-16 flex max-h-[900px] min-h-svh flex-col items-center justify-center overflow-hidden py-20 lg:-mt-20">
        <Hero />
      </section>

      {/* Endorsements Section */}
      <section id="endorsements" className="border-b py-14 md:py-24">
        <div className="container mx-auto px-4 md:px-12">
          <Endorsements />
        </div>
      </section>

      {/* Featured Agents Section */}
      <section id="featured-agents" className="py-14 md:py-24">
        <div className="container mx-auto px-4 md:px-12">
          <FeaturedAgents />
        </div>
      </section>

      {/* Number of Talks Section */}
      <section id="number-talks" className="bg-muted py-14 md:py-24">
        <div className="container mx-auto px-4 md:px-12">
          <NumberTalks />
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-14 md:py-24">
        <div className="container mx-auto px-4 md:px-12">
          <HowItWorks />
        </div>
      </section>

      {/* What Our Users Say Section */}
      <section id="what-our-users-say" className="bg-muted py-14 md:py-24">
        <div className="container mx-auto px-4 md:px-12">
          <Testimonials />
        </div>
      </section>

      {/* Monetize Your Agent Section */}
      <section
        id="monetize"
        className="border-muted-foreground/10 border-b py-14 md:py-24"
      >
        <div className="container mx-auto px-4 md:px-12">
          <MonetizeYourAgent />
        </div>
      </section>

      {/* Join Our Community Section */}
      <section id="join-our-community" className="py-14 md:py-24">
        <div className="container mx-auto px-4 md:px-12">
          <JoinOurCommunity />
        </div>
      </section>
    </>
  );
}
