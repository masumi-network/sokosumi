import { Metadata } from "next";

import AgentCard from "@/components/agent-card";
import { dummyAgents } from "@/data/agents";

import { FeaturedAgent } from "./featured-agent";

export const metadata: Metadata = {
  title: "Gallery | Sokosumi",
  description: "Explore our collection of images and artwork.",
};

export default function GalleryPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="space-y-12">
        {/* Featured Agent Section */}
        <FeaturedAgent
          sectionTitle="an absolute must-have"
          agentTitle="AI Market Analysis Expert"
          description="Advanced AI agent specialized in market analysis and trend prediction. Provides detailed insights and forecasts for various market sectors."
          imageUrl="/placeholder.svg"
          imageAlt="AI Market Analysis Expert"
          buttonText="Hire this banger"
          tags={[
            "Market Analysis",
            "Trend Prediction",
            "AI Expert",
            "Data Insights",
          ]}
        />

        {/* Agent Cards Grid */}
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {dummyAgents.map((agent, index) => (
            <AgentCard key={index} agent={agent} />
          ))}
        </div>
      </div>
    </div>
  );
}
