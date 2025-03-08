export interface Agent {
  title: string;
  description: string;
  rating: number;
  image: string;
  buttonText: string;
  pricingTitle: string;
  pricingCaption: string;
  tags: string[];
}

export const dummyAgents: Agent[] = [
  {
    title: "Market Analysis Expert",
    description:
      "Advanced AI agent specialized in market analysis and trend prediction. Provides detailed insights and forecasts for various market sectors.",
    rating: 5,
    image: "/placeholder.svg",
    buttonText: "Run Analysis",
    pricingTitle: "Free Trial",
    pricingCaption: "Normal Price: 15-25 credits/run",
    tags: ["Analytics", "Finance", "Trends", "Forecasting"],
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
    tags: [],
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
    tags: ["Data", "Visualization", "Reports", "Analytics"],
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
    tags: ["Development", "Code Quality", "Bug Detection", "Best Practices"],
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
    tags: ["SEO", "Marketing", "Content", "Analytics"],
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
    tags: ["Social Media", "Marketing", "Analytics", "Engagement"],
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
    tags: ["Customer Service", "NLP", "24/7", "Support"],
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
    tags: ["Finance", "Investment", "Portfolio", "Planning"],
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
    tags: ["Translation", "Languages", "Localization", "Cultural"],
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
    tags: ["Research", "Analysis", "Data", "Synthesis"],
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
    tags: ["Design", "UI", "UX", "Interface"],
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
    tags: ["Legal", "Documents", "Contracts", "Compliance"],
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
    tags: ["Video", "Content", "Storytelling", "Production"],
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
    tags: ["HR", "Recruitment", "Onboarding", "Documentation"],
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
    tags: ["Project Management", "Planning", "Resources", "Timeline"],
  },
];
