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
      <section className="relative -mt-24 flex max-h-[900px] min-h-svh flex-col items-center justify-center overflow-hidden py-20">
        <div className="blur-in absolute inset-0 z-0 h-full w-full bg-[linear-gradient(rgba(255,255,255,0.4),rgba(255,255,255,0.4)),url('/backgrounds/hero-bg.png')] bg-cover bg-center bg-no-repeat dark:bg-[linear-gradient(rgba(23,23,23,0.4),rgba(23,23,23,0.4)),url('/backgrounds/hero-bg.png')]" />
        <div className="container h-full px-12 md:px-6">
          <Hero />
        </div>
      </section>

      {/* Endorsements Section */}
      <section id="endorsements" className="border-b py-24">
        <div className="container mx-auto px-12">
          <Endorsements />
        </div>
      </section>

      {/* Featured Agents Section */}
      <section id="featured-agents" className="py-24">
        <div className="container mx-auto px-12">
          <FeaturedAgents />
        </div>
      </section>

      {/* Number of Talks Section */}
      <section id="number-talks" className="bg-muted py-24">
        <div className="container mx-auto px-12">
          <NumberTalks />
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-24">
        <div className="container mx-auto px-12">
          <HowItWorks />
        </div>
      </section>

      {/* Testimonials Section */}
      <section id="testimonials" className="bg-muted py-24">
        <div className="container mx-auto px-12">
          <Testimonials />
        </div>
      </section>

      {/* Monetize Your Agent Section */}
      <section id="monetize" className="border-muted-foreground/10 border-b">
        <div className="container mx-auto px-12">
          <MonetizeYourAgent />
        </div>
      </section>

      {/* Join Our Community Section */}
      <section id="join-our-community" className="py-24">
        <div className="container mx-auto px-12">
          <JoinOurCommunity />
        </div>
      </section>
    </>
  );
}
