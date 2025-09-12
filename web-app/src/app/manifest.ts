import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sōkosumi",
    short_name: "Sōkosumi",
    description:
      "Hire yourself an agent to finish the most time consuming tasks",
    start_url: "https://app.sokosumi.com",
    display: "standalone",
    background_color: "#6400FF",
    icons: [
      {
        src: "public/images/app-icons/manifest-icon-192.maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "public/images/app-icons/manifest-icon-192.maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "public/images/app-icons/manifest-icon-512.maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "public/images/app-icons/manifest-icon-512.maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
