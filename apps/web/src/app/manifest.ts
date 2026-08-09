import type { MetadataRoute } from "next";

/**
 * `scope: "/"` is required: default scope is the directory of `start_url`, so
 * install from `/chat/chats` would scope to `/chat/` and tab links (`/tasks`,
 * …) open outside the PWA. Keep `start_url` origin-relative for preview hosts.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sokosumi",
    short_name: "Sokosumi",
    description:
      "Hire yourself an agent to finish the most time consuming tasks",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#6400FF",
    icons: [
      {
        src: "/images/app-icons/manifest-icon-192.maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/images/app-icons/manifest-icon-192.maskable.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/images/app-icons/manifest-icon-512.maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/images/app-icons/manifest-icon-512.maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
