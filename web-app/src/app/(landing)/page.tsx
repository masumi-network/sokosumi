import { AuthButtons } from "@/app/(landing)/components/auth-buttons";
import Footer from "@/app/(landing)/components/footer";
import { HorizontalScrollList } from "@/app/(landing)/components/horizontal-scroll-list";
import { MainNav } from "@/app/(landing)/components/main-nav";
import TrustedPartners from "@/app/(landing)/components/trusted-partners";
import AgentCard from "@/components/agent-card";
import SokosumiLogo from "@/components/sokosumi-logo";

import HowItWorks from "./components/how-it-works";

export default function LandingPage() {
  return (
    <>
      <div className="w-full">
        <TopNavigation />
        <div className="mx-auto space-y-16 px-4 pt-16 lg:pt-24">
          <MainContent />
          <AgentsGallery />
          <TrustedPartners />
        </div>
      </div>
      <div id="agents-gallery" className="w-full bg-[#F2F2F3]">
        <div className="container mx-auto space-y-16 px-4 py-16 lg:py-24">
          <h2 className="text-2xl font-bold">Agent Gallery</h2>
        </div>
      </div>
      <div id="number-talks" className="w-full bg-[#E4B1F6]">
        <div className="container mx-auto space-y-16 px-4 py-16 lg:py-24">
          <h2 className="text-2xl font-bold">Number of Talks</h2>
        </div>
      </div>
      <div id="how-it-works">
        <div className="container mx-auto px-4 py-16">
          <HowItWorks />
        </div>
      </div>
      <div id="what-our-users-say" className="w-full bg-[#DFDFDF]">
        <div className="container mx-auto space-y-16 px-4 py-16 lg:py-24">
          <h2 className="text-2xl font-bold">What our users say</h2>
        </div>
      </div>
      <div id="contribute">
        <div className="container mx-auto space-y-16 px-4 py-16 lg:py-24">
          <h2 className="text-2xl font-bold">Contribute</h2>
        </div>
      </div>
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
    <div className="w-full">
      <HorizontalScrollList>
        {agents.map((agent) => (
          <AgentCard key={agent.id} {...agent} />
        ))}
      </HorizontalScrollList>
    </div>
  );
}

function MainContent() {
  return (
    <div className="container mx-auto flex justify-center">
      <div className="flex flex-col items-center gap-12 text-center">
        {/* First text box */}
        <div className="w-full">
          <p className="text-5xl font-normal leading-tight text-slate-500">
            Hire yourself an agent to finish
            <br className="hidden sm:block" />
            the most time consuming tasks
          </p>
        </div>

        {/* Second text box */}
        <div className="w-full">
          <p className="text-6xl font-bold">
            Marketplace for Agent-to-Agent interactions
          </p>
        </div>
      </div>
    </div>
  );
}
