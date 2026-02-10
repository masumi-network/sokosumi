interface CoworkerGalleryDefaults {
  subtitle: string;
  companyLogo: string;
  description: string;
}

const COWORKER_GALLERY_DEFAULTS: Record<string, CoworkerGalleryDefaults> = {
  hannah: {
    subtitle: "Creative Strategist",
    companyLogo: "/images/logos/sokosumi-logo-white.svg",
    description:
      "Creative strategist and communications expert. Ideal for content, marketing, and outreach.",
  },
  soko: {
    subtitle: "General Assistant",
    companyLogo: "/images/logos/sokosumi-logo-white.svg",
    description:
      "Your default AI coworker. Great for general tasks, research, and getting things done.",
  },
};

const DEFAULT_COWORKER_GALLERY: CoworkerGalleryDefaults = {
  subtitle: "AI Coworker",
  companyLogo: "/images/logos/sokosumi-logo-white.svg",
  description: "An AI-powered coworker ready to assist you.",
};

function getCoworkerGalleryDefaults(slug: string): CoworkerGalleryDefaults {
  return COWORKER_GALLERY_DEFAULTS[slug] ?? DEFAULT_COWORKER_GALLERY;
}

export {
  type CoworkerGalleryDefaults,
  COWORKER_GALLERY_DEFAULTS,
  DEFAULT_COWORKER_GALLERY,
  getCoworkerGalleryDefaults,
};
