export interface Agent {
  id: string;
  title: string;
  description: string;
  author: string;
  rating: number;
  image: string;
  price: number;
  tags: string[];
  examples?: number;
  legal?: {
    privacyPolicy?: string;
    terms?: string;
    other?: string;
  };
}

export const dummyAgents: Agent[] = [
  {
    id: "1",
    title: "Market Analysis Expert",
    description:
      "Advanced AI agent specialized in market analysis and trend prediction. Provides detailed insights and forecasts for various market sectors.",
    rating: 5,
    author: "John Doe",
    image: "/placeholder.svg",
    price: 20,
    tags: ["Analytics", "Finance", "Trends", "Forecasting"],
    examples: 4,
    legal: {
      privacyPolicy: "https://example.com/privacy",
      terms: "https://example.com/terms",
      other: "https://example.com/other",
    },
  },
  {
    id: "2",
    title: "Content Creation Pro",
    description:
      "Creative AI agent that generates high-quality content for blogs, social media, and marketing materials. Specializes in engaging storytelling.",
    rating: 4,
    author: "Jane Smith",
    image: "/placeholder.svg",
    price: 0,
    tags: [],
    legal: {
      privacyPolicy: "https://example.com/privacy",
      terms: "https://example.com/terms",
    },
  },
  {
    id: "3",
    title: "Data Visualization Expert",
    description:
      "Transforms complex data into beautiful, interactive visualizations. Perfect for business reports and presentations.",
    rating: 4,
    author: "Jane Smith",
    image: "/placeholder.svg",
    price: 12,
    tags: ["Data", "Visualization", "Reports", "Analytics"],
    examples: 3,
  },
  {
    id: "4",
    title: "Code Review Assistant",
    description:
      "AI-powered code review expert that helps identify bugs, suggests improvements, and ensures code quality.",
    rating: 5,
    author: "Service Plan",
    image: "/placeholder.svg",
    price: 15,
    tags: ["Development", "Code Quality", "Bug Detection", "Best Practices"],
    examples: 1,
    legal: {
      privacyPolicy: "https://example.com/privacy",
      terms: "https://example.com/terms",
      other: "https://example.com/other",
    },
  },
  {
    id: "5",
    title: "SEO Optimization Pro",
    description:
      "Specialized in optimizing content for search engines. Provides actionable recommendations for better rankings.",
    rating: 3,
    author: "NMKR",
    image: "/placeholder.svg",
    price: 10,
    tags: ["SEO", "Marketing", "Content", "Analytics"],
    examples: 6,
    legal: {
      privacyPolicy: "https://example.com/privacy",
      terms: "https://example.com/terms",
      other: "https://example.com/other",
    },
  },
  {
    id: "6",
    title: "Social Media Manager",
    description:
      "Manages social media presence with AI-powered content scheduling, engagement analysis, and trend tracking.",
    rating: 3,
    author: "NMKR",
    image: "/placeholder.svg",
    price: 15,
    tags: ["Social Media", "Marketing", "Analytics", "Engagement"],
    examples: 3,
    legal: {
      terms: "https://example.com/terms",
      other: "https://example.com/other",
    },
  },
  {
    id: "7",
    title: "Customer Support AI",
    description:
      "Handles customer inquiries with natural language processing. Provides 24/7 support with human-like responses.",
    rating: 4,
    author: "Service Plan",
    image: "/placeholder.svg",
    price: 20,
    tags: ["Customer Service", "NLP", "24/7", "Support"],
    examples: 2,
  },
  {
    id: "8",
    title: "Financial Advisor",
    description:
      "AI-powered financial advisor that provides personalized investment recommendations and portfolio analysis.",
    rating: 3,
    author: "John Doe",
    image: "/placeholder.svg",
    price: 25,
    tags: ["Finance", "Investment", "Portfolio", "Planning"],
    examples: 1,
  },
  {
    id: "9",
    title: "Translation Expert",
    description:
      "Professional translator supporting multiple languages with context-aware translations and cultural adaptation.",
    rating: 2,
    author: "John Doe",
    image: "/placeholder.svg",
    price: 10,
    tags: ["Translation", "Languages", "Localization", "Cultural"],
    examples: 1,
  },
  {
    id: "10",
    title: "Research Assistant",
    description:
      "Comprehensive research assistant that gathers, analyzes, and synthesizes information from various sources.",
    rating: 4,
    author: "John Doe",
    image: "/placeholder.svg",
    price: 15,
    tags: ["Research", "Analysis", "Data", "Synthesis"],
  },
  {
    id: "11",
    title: "UI/UX Designer",
    description:
      "AI-powered design assistant that creates user-friendly interfaces and provides design recommendations.",
    rating: 1,
    author: "John Doe",
    image: "/placeholder.svg",
    price: 20,
    tags: ["Design", "UI", "UX", "Interface"],
  },
  {
    id: "12",
    title: "Legal Document Analyzer",
    description:
      "Specialized in analyzing legal documents, contracts, and agreements. Identifies potential issues and risks.",
    rating: 5,
    author: "John Doe",
    image: "/placeholder.svg",
    price: 25,
    tags: ["Legal", "Documents", "Contracts", "Compliance"],
  },
  {
    id: "13",
    title: "Video Content Creator",
    description:
      "Creates engaging video content, including scripts, storyboards, and editing recommendations.",
    rating: 4,
    author: "John Doe",
    image: "/placeholder.svg",
    price: 30,
    tags: ["Video", "Content", "Storytelling", "Production"],
  },
  {
    id: "14",
    title: "HR Assistant",
    description:
      "Helps with recruitment, employee onboarding, and HR documentation. Streamlines HR processes.",
    rating: 3,
    author: "John Doe",
    image: "/placeholder.svg",
    price: 15,
    tags: ["HR", "Recruitment", "Onboarding", "Documentation"],
  },
  {
    id: "15",
    title: "Project Manager",
    description:
      "AI project manager that helps with task tracking, resource allocation, and project timeline optimization.",
    rating: 4,
    author: "John Doe",
    image: "/placeholder.svg",
    price: 20,
    tags: ["Project Management", "Planning", "Resources", "Timeline"],
  },
];
