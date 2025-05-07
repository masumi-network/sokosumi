import { FC } from "react";

export const Loading: FC = () => (
  <section
    className="prose dark:prose-invert max-w-full p-4 pt-8 md:mx-auto md:max-w-2/3 xl:max-w-1/2"
    aria-busy="true"
    aria-label="Loading terms of service"
  >
    <div className="animate-pulse space-y-8">
      {/* Title skeleton */}
      <div className="bg-muted h-10 w-2/3 rounded" />
      {/* Section headings and paragraphs skeleton */}
      {[...Array(4)].map((_, i) => (
        <div key={i} className="space-y-4">
          <div className="bg-muted h-6 w-1/3 rounded" />
          <div className="space-y-2">
            <div className="bg-muted h-4 w-full rounded" />
            <div className="bg-muted h-4 w-5/6 rounded" />
            <div className="bg-muted h-4 w-2/3 rounded" />
          </div>
        </div>
      ))}
    </div>
  </section>
);

export default Loading;
