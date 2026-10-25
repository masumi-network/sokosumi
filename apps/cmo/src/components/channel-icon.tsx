import {
  AtSign,
  Globe,
  Mail,
  Megaphone,
  MessageCircle,
  Newspaper,
  Sparkles,
} from "lucide-react";
import { type ComponentProps, useId } from "react";

// Brand marks for the networks Cuso publishes to. Glyphs are Simple Icons
// paths (LinkedIn is Font Awesome's), as in Sokosumi Web; the colours are
// each network's own, and X follows the text colour as its guidelines ask.

type SvgProps = ComponentProps<"svg">;

function XMark(props: SvgProps) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path
        fill="currentColor"
        d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"
      />
    </svg>
  );
}

function LinkedInMark(props: SvgProps) {
  return (
    <svg viewBox="0 32 448 448" {...props}>
      <path
        style={{ fill: "var(--mark-linkedin)" }}
        d="M416 32H31.9C14.3 32 0 46.5 0 64.3v383.4C0 465.5 14.3 480 31.9 480H416c17.6 0 32-14.5 32-32.3V64.3c0-17.8-14.4-32.3-32-32.3z"
      />
      <path
        style={{ fill: "var(--mark-white)" }}
        d="M135.4 416H69V202.2h66.5V416zm-33.2-243c-21.3 0-38.5-17.3-38.5-38.5S80.9 96 102.2 96c21.2 0 38.5 17.3 38.5 38.5 0 21.3-17.2 38.5-38.5 38.5zm282.1 243h-66.4V312c0-24.8-.5-56.7-34.5-56.7-34.6 0-39.9 27-39.9 54.9V416h-66.4V202.2h63.7v29.2h.9c8.9-16.8 30.6-34.5 62.9-34.5 67.2 0 79.7 44.3 79.7 101.9V416z"
      />
    </svg>
  );
}

function InstagramMark(props: SvgProps) {
  const gradientId = `ig-${useId()}`;
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <defs>
        <radialGradient
          id={gradientId}
          cx="7.2"
          cy="25.7"
          r="30.7"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" style={{ stopColor: "var(--mark-instagram-1)" }} />
          <stop
            offset="0.25"
            style={{ stopColor: "var(--mark-instagram-2)" }}
          />
          <stop offset="0.5" style={{ stopColor: "var(--mark-instagram-3)" }} />
          <stop
            offset="0.75"
            style={{ stopColor: "var(--mark-instagram-4)" }}
          />
          <stop offset="1" style={{ stopColor: "var(--mark-instagram-5)" }} />
        </radialGradient>
      </defs>
      <rect width="24" height="24" rx="6" fill={`url(#${gradientId})`} />
      <rect
        x="5.5"
        y="5.5"
        width="13"
        height="13"
        rx="4"
        fill="none"
        style={{ stroke: "var(--mark-white)" }}
        strokeWidth="1.8"
      />
      <circle
        cx="12"
        cy="12"
        r="3.1"
        fill="none"
        style={{ stroke: "var(--mark-white)" }}
        strokeWidth="1.8"
      />
      <circle cx="16.4" cy="7.6" r="1" style={{ fill: "var(--mark-white)" }} />
    </svg>
  );
}

function FacebookMark(props: SvgProps) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <circle
        cx="12"
        cy="12.044"
        r="12"
        style={{ fill: "var(--mark-facebook)" }}
      />
      <path
        style={{ fill: "var(--mark-white)" }}
        d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245A12 12 0 0 1 9.101 23.691Z"
      />
    </svg>
  );
}

function YouTubeMark(props: SvgProps) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path
        style={{ fill: "var(--mark-youtube)" }}
        d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"
      />
      <path
        style={{ fill: "var(--mark-white)" }}
        d="M9.545 15.568V8.432L15.818 12z"
      />
    </svg>
  );
}

function GitHubMark(props: SvgProps) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path
        fill="currentColor"
        d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
      />
    </svg>
  );
}

function BlueskyMark(props: SvgProps) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path
        style={{ fill: "var(--mark-bluesky)" }}
        d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8Z"
      />
    </svg>
  );
}

const TIKTOK_PATH =
  "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z";

function TikTokMark(props: SvgProps) {
  return (
    <svg viewBox="-1 -1 26 26" {...props}>
      <path
        d={TIKTOK_PATH}
        style={{ fill: "var(--mark-tiktok-cyan)" }}
        transform="translate(-0.9 -0.9)"
      />
      <path
        d={TIKTOK_PATH}
        style={{ fill: "var(--mark-tiktok-red)" }}
        transform="translate(0.9 0.9)"
      />
      <path d={TIKTOK_PATH} fill="currentColor" />
    </svg>
  );
}

/** A channel's mark: the network's own logo, or an icon for owned media. */
export function ChannelIcon({
  channel,
  size = 16,
}: {
  channel: string;
  size?: number;
}) {
  const props = { width: size, height: size, "aria-hidden": true } as const;
  switch (channel.toLowerCase()) {
    case "x":
    case "twitter":
      return <XMark {...props} />;
    case "linkedin":
      return <LinkedInMark {...props} />;
    case "instagram":
      return <InstagramMark {...props} />;
    case "facebook":
      return <FacebookMark {...props} />;
    case "youtube":
      return <YouTubeMark {...props} />;
    case "tiktok":
      return <TikTokMark {...props} />;
    case "github":
      return <GitHubMark {...props} />;
    case "bluesky":
      return <BlueskyMark {...props} />;
    case "mastodon":
    case "threads":
      return <AtSign size={size} aria-hidden />;
    case "discord":
      return <MessageCircle size={size} aria-hidden />;
    case "newsletter":
    case "email":
      return <Mail size={size} aria-hidden />;
    case "ads":
    case "meta":
    case "google":
      return <Megaphone size={size} aria-hidden />;
    case "blog":
      return <Newspaper size={size} aria-hidden />;
    case "website":
    case "seo":
      return <Globe size={size} aria-hidden />;
    default:
      return <Sparkles size={size} aria-hidden />;
  }
}
