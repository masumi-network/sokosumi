import type { ProjectSocialConnection } from "@sokosumi/core-client";
import type { ComponentType } from "react";
import { SiX } from "react-icons/si";
import {
  FacebookIcon,
  InstagramIcon,
  LinkedInIcon,
  TikTokIcon,
  YouTubeIcon,
} from "@/components/social-icons";

export const SOCIAL_PROVIDERS = [
  { id: "x", name: "X", Icon: SiX },
  // Not offered yet: publishing needs TikTok's app review first.
  { id: "tiktok", name: "TikTok", Icon: TikTokIcon, comingSoon: true },
  { id: "instagram", name: "Instagram", Icon: InstagramIcon },
  { id: "linkedin", name: "LinkedIn", Icon: LinkedInIcon },
  { id: "facebook", name: "Facebook", Icon: FacebookIcon },
  { id: "youtube", name: "YouTube", Icon: YouTubeIcon },
] as const satisfies readonly {
  id: ProjectSocialConnection["provider"];
  name: string;
  Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  comingSoon?: boolean;
}[];
