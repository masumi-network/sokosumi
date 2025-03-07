import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Gallery | Sokosumi",
  description: "Explore our collection of images and artwork.",
};

export default function GalleryPage() {
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="mb-6 text-4xl font-bold">Gallery</h1>
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
