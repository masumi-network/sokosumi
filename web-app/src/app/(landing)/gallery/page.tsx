import { Metadata } from "next";

import { FeaturedAgent } from "./featured-agent";

export const metadata: Metadata = {
  title: "Gallery | Sokosumi",
  description: "Explore our collection of images and artwork.",
};

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

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="flex aspect-square items-center justify-center rounded-lg bg-muted"
          >
            <span className="text-muted-foreground">
              Placeholder {index + 1}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
