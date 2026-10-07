import type { SocialPost } from "@sokosumi/core-client";
import type { ComponentProps } from "react";
import { SiX } from "react-icons/si";
import {
  FacebookIcon,
  InstagramIcon,
  LinkedInIcon,
  TikTokIcon,
  YouTubeIcon,
} from "@/components/social-icons";

type Provider = SocialPost["provider"];

/** The connected provider's brand mark, following each network's color rules. */
export function SocialPostProviderIcon({
  provider,
  ...props
}: { provider: Provider } & ComponentProps<"svg">) {
  switch (provider) {
    case "x":
      return <SiX {...props} />;
    case "linkedin":
      return <LinkedInIcon {...props} />;
    case "facebook":
      return <FacebookIcon {...props} />;
    case "instagram":
      return <InstagramIcon {...props} />;
    case "tiktok":
      return <TikTokIcon {...props} />;
    case "youtube":
      return <YouTubeIcon {...props} />;
  }
}
