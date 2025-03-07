import { Metadata } from "next";

import AgentCard from "@/components/agent-card";

import { FeaturedAgent } from "./featured-agent";

export const metadata: Metadata = {
  title: "Gallery | Sokosumi",
  description: "Explore our collection of images and artwork.",
};

const dummyAgents = [
  {
    title: "Market Analysis Expert",
    description:
      "Advanced AI agent specialized in market analysis and trend prediction. Provides detailed insights and forecasts for various market sectors.",
    rating: 5,
    image: "/placeholder.svg",
    buttonText: "Run Analysis",
    pricingTitle: "Free Trial",
    pricingCaption: "Normal Price: 15-25 credits/run",
  },
  {
    title: "Content Creation Pro",
    description:
      "Creative AI agent that generates high-quality content for blogs, social media, and marketing materials. Specializes in engaging storytelling.",
    rating: 4,
    image: "/placeholder.svg",
    buttonText: "Create Content",
    pricingTitle: "Free Trial",
    pricingCaption: "Normal Price: 10-20 credits/run",
  },
  {
    title: "Data Visualization Expert",
    description:
      "Transforms complex data into beautiful, interactive visualizations. Perfect for business reports and presentations.",
    rating: 4,
    image: "/placeholder.svg",
    buttonText: "Visualize Data",
    pricingTitle: "Free Trial",
    pricingCaption: "Normal Price: 12-22 credits/run",
  },
  {
    title: "Code Review Assistant",
    description:
      "AI-powered code review expert that helps identify bugs, suggests improvements, and ensures code quality.",
    rating: 5,
    image: "/placeholder.svg",
    buttonText: "Review Code",
    pricingTitle: "Free Trial",
    pricingCaption: "Normal Price: 15-30 credits/run",
  },
  {
    title: "SEO Optimization Pro",
    description:
      "Specialized in optimizing content for search engines. Provides actionable recommendations for better rankings.",
    rating: 3,
    image: "/placeholder.svg",
    buttonText: "Optimize SEO",
    pricingTitle: "Free Trial",
    pricingCaption: "Normal Price: 10-25 credits/run",
  },
  {
    title: "Social Media Manager",
    description:
      "Manages social media presence with AI-powered content scheduling, engagement analysis, and trend tracking.",
    rating: 3,
    image: "/placeholder.svg",
    buttonText: "Manage Social",
    pricingTitle: "Free Trial",
    pricingCaption: "Normal Price: 15-35 credits/run",
  },
  {
    title: "Customer Support AI",
    description:
      "Handles customer inquiries with natural language processing. Provides 24/7 support with human-like responses.",
    rating: 4,
    image: "/placeholder.svg",
    buttonText: "Start Support",
    pricingTitle: "Free Trial",
    pricingCaption: "Normal Price: 20-40 credits/run",
  },
  {
    title: "Financial Advisor",
    description:
      "AI-powered financial advisor that provides personalized investment recommendations and portfolio analysis.",
    rating: 3,
    image: "/placeholder.svg",
    buttonText: "Get Advice",
    pricingTitle: "Free Trial",
    pricingCaption: "Normal Price: 25-45 credits/run",
  },
  {
    title: "Translation Expert",
    description:
      "Professional translator supporting multiple languages with context-aware translations and cultural adaptation.",
    rating: 2,
    image: "/placeholder.svg",
    buttonText: "Translate",
    pricingTitle: "Free Trial",
    pricingCaption: "Normal Price: 10-20 credits/run",
  },
  {
    title: "Research Assistant",
    description:
      "Comprehensive research assistant that gathers, analyzes, and synthesizes information from various sources.",
    rating: 4,
    image: "/placeholder.svg",
    buttonText: "Start Research",
    pricingTitle: "Free Trial",
    pricingCaption: "Normal Price: 15-30 credits/run",
  },
  {
    title: "UI/UX Designer",
    description:
      "AI-powered design assistant that creates user-friendly interfaces and provides design recommendations.",
    rating: 1,
    image: "/placeholder.svg",
    buttonText: "Design UI",
    pricingTitle: "Free Trial",
    pricingCaption: "Normal Price: 20-40 credits/run",
  },
  {
    title: "Legal Document Analyzer",
    description:
      "Specialized in analyzing legal documents, contracts, and agreements. Identifies potential issues and risks.",
    rating: 5,
    image: "/placeholder.svg",
    buttonText: "Analyze Docs",
    pricingTitle: "Free Trial",
    pricingCaption: "Normal Price: 25-50 credits/run",
  },
  {
    title: "Video Content Creator",
    description:
      "Creates engaging video content, including scripts, storyboards, and editing recommendations.",
    rating: 4,
    image: "/placeholder.svg",
    buttonText: "Create Video",
    pricingTitle: "Free Trial",
    pricingCaption: "Normal Price: 30-60 credits/run",
  },
  {
    title: "HR Assistant",
    description:
      "Helps with recruitment, employee onboarding, and HR documentation. Streamlines HR processes.",
    rating: 3,
    image: "/placeholder.svg",
    buttonText: "HR Help",
    pricingTitle: "Free Trial",
    pricingCaption: "Normal Price: 15-35 credits/run",
  },
  {
    title: "Project Manager",
    description:
      "AI project manager that helps with task tracking, resource allocation, and project timeline optimization.",
    rating: 4,
    image: "/placeholder.svg",
    buttonText: "Manage Project",
    pricingTitle: "Free Trial",
    pricingCaption: "Normal Price: 20-40 credits/run",
  },
];

export default function GalleryPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      {/* Featured Agent Section */}
      <div className="mb-12">
        <FeaturedAgent
          sectionTitle="an absolute must-have"
          agentTitle="AI Market Analysis Expert"
          description="Advanced AI agent specialized in market analysis and trend prediction. Provides detailed insights and forecasts for various market sectors."
          imageUrl="/placeholder.svg"
          imageAlt="AI Market Analysis Expert"
          buttonText="Hire this banger"
        />
      </div>

      {/* Agent Cards Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {dummyAgents.map((agent, index) => (
          <AgentCard
            key={index}
            title={agent.title}
            description={agent.description}
            rating={agent.rating}
            image={agent.image}
            buttonText={agent.buttonText}
            pricingTitle={agent.pricingTitle}
            pricingCaption={agent.pricingCaption}
          />
        ))}
      </div>
    </div>
  );
}
