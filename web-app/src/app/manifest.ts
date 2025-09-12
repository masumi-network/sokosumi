import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sōkosumi",
    short_name: "Sōkosumi",
    description:
      "Hire yourself an agent to finish the most time consuming tasks",
    start_url: "https://app.sokosumi.com",
    display: "standalone",
    background_color: "#fff",
    theme_color: "#fff",
    icons: [
      {
        src: "images/icons/sokosumi-icon-square.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
