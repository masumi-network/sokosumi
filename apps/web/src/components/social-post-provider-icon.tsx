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
  const iconProps = {
    "data-testid": "social-post-provider-icon",
    ...props,
  };
  switch (provider) {
    case "x":
      return <SiX {...iconProps} />;
    case "linkedin":
      return <LinkedInIcon {...iconProps} />;
    case "facebook":
      return <FacebookIcon {...iconProps} />;
    case "instagram":
      return <InstagramIcon {...iconProps} />;
    case "tiktok":
      return <TikTokIcon {...iconProps} />;
    case "youtube":
      return <YouTubeIcon {...iconProps} />;
  }
}
