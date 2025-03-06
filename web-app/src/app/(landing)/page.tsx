import { Loader, TrendingDown, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";

import { AuthButtons } from "@/app/(landing)/components/auth-buttons";
import Footer from "@/app/(landing)/components/footer";
import { MainNav } from "@/app/(landing)/components/main-nav";
import AgentCard from "@/components/agent-card";
import IconTitleDescription from "@/components/icon-title-description";
import { SokosumiLogo } from "@/components/masumi-logos";

import HorizontalScroll from "./components/horizontal-scroll";
import HowItWorks from "./components/how-it-works";
import { JoinOurCommunity } from "./components/join-our-community";
import { MonetizeYourAgent } from "./components/monetize-your-agent";

export default function LandingPage() {
  return (
    <>
      {/* Top Navigation */}
      <TopNavigation />

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

      <div id="footer">
        <Footer />
      </div>
    </>
  );
}

function TopNavigation() {
  return (
    <div className="w-full px-4 py-6 lg:px-8">
      <div className="container mx-auto flex items-center justify-between gap-6">
        {/* Left - Logo */}
        <SokosumiLogo />

        {/* Middle - Navigation Links */}
        <MainNav />

        {/* Right - Auth Buttons */}
        <AuthButtons />
      </div>
    </div>
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
            <p className="text-5xl font-normal leading-tight text-slate-500 md:whitespace-pre-line">
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
  const agents = [
    {
      id: 1,
      image: "/agent-card-placeholder.png",
      rating: 4,
      title: "Agent Smith",
      description:
        "Professional real estate agent with over 10 years of experience in the market.",
      buttonText: "Run Analysis",
      pricingTitle: "Free Trial",
      pricingCaption: "Normal Price: 10-30 credits/run",
    },
    {
      id: 2,
      image: "/agent-card-placeholder.png",
      rating: 4,
      title: "Agent Smith",
      description:
        "Professional real estate agent with over 10 years of experience in the market.",
      buttonText: "Run Analysis",
      pricingTitle: "Free Trial",
      pricingCaption: "Normal Price: 10-30 credits/run",
    },
    {
      id: 3,
      image: "/agent-card-placeholder.png",
      rating: 4,
      title: "Agent Smith",
      description:
        "Professional real estate agent with over 10 years of experience in the market.",
      buttonText: "Run Analysis",
      pricingTitle: "Free Trial",
      pricingCaption: "Normal Price: 10-30 credits/run",
    },
    {
      id: 4,
      image: "/agent-card-placeholder.png",
      rating: 4,
      title: "Agent Smith",
      description:
        "Professional real estate agent with over 10 years of experience in the market.",
      buttonText: "Run Analysis",
      pricingTitle: "Free Trial",
      pricingCaption: "Normal Price: 10-30 credits/run",
    },
    {
      id: 5,
      image: "/agent-card-placeholder.png",
      rating: 4,
      title: "Agent Smith",
      description:
        "Professional real estate agent with over 10 years of experience in the market.",
      buttonText: "Run Analysis",
      pricingTitle: "Free Trial",
      pricingCaption: "Normal Price: 10-30 credits/run",
    },
    {
      id: 6,
      image: "/agent-card-placeholder.png",
      rating: 4,
      title: "Agent Smith",
      description:
        "Professional real estate agent with over 10 years of experience in the market.",
      buttonText: "Run Analysis",
      pricingTitle: "Free Trial",
      pricingCaption: "Normal Price: 10-30 credits/run",
    },
    {
      id: 7,
      image: "/agent-card-placeholder.png",
      rating: 4,
      title: "Agent Smith",
      description:
        "Professional real estate agent with over 10 years of experience in the market.",
      buttonText: "Run Analysis",
      pricingTitle: "Free Trial",
      pricingCaption: "Normal Price: 10-30 credits/run",
    },
    {
      id: 8,
      image: "/agent-card-placeholder.png",
      rating: 4,
      title: "Agent Smith",
      description:
        "Professional real estate agent with over 10 years of experience in the market.",
      buttonText: "Run Analysis",
      pricingTitle: "Free Trial",
      pricingCaption: "Normal Price: 10-30 credits/run",
    },
    {
      id: 9,
      image: "/agent-card-placeholder.png",
      rating: 4,
      title: "Agent Smith",
      description:
        "Professional real estate agent with over 10 years of experience in the market.",
      buttonText: "Run Analysis",
      pricingTitle: "Free Trial",
      pricingCaption: "Normal Price: 10-30 credits/run",
    },
  ];
  return (
    <HorizontalScroll>
      {agents.map((agent) => (
        <AgentCard key={agent.id} {...agent} />
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
