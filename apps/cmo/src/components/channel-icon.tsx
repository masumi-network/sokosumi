import { Globe, Mail, Megaphone, Newspaper, Sparkles } from "lucide-react";
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
        fill="#0A66C2"
        d="M416 32H31.9C14.3 32 0 46.5 0 64.3v383.4C0 465.5 14.3 480 31.9 480H416c17.6 0 32-14.5 32-32.3V64.3c0-17.8-14.4-32.3-32-32.3z"
      />
      <path
        fill="#FFFFFF"
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
          <stop offset="0" stopColor="#FFD600" />
          <stop offset="0.25" stopColor="#FF7A00" />
          <stop offset="0.5" stopColor="#FF0069" />
          <stop offset="0.75" stopColor="#D300C5" />
          <stop offset="1" stopColor="#7638FA" />
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
        stroke="#fff"
        strokeWidth="1.8"
      />
      <circle
        cx="12"
        cy="12"
        r="3.1"
        fill="none"
        stroke="#fff"
        strokeWidth="1.8"
      />
      <circle cx="16.4" cy="7.6" r="1" fill="#fff" />
    </svg>
  );
}

function FacebookMark(props: SvgProps) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <circle cx="12" cy="12.044" r="12" fill="#0866FF" />
      <path
        fill="#FFFFFF"
        d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245A12 12 0 0 1 9.101 23.691Z"
      />
    </svg>
  );
}

function YouTubeMark(props: SvgProps) {
  return (
    <svg viewBox="0 0 24 24" {...props}>
      <path
        fill="#FF0000"
        d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814z"
      />
      <path fill="#FFFFFF" d="M9.545 15.568V8.432L15.818 12z" />
    </svg>
  );
}

const TIKTOK_PATH =
  "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z";

function TikTokMark(props: SvgProps) {
  return (
    <svg viewBox="-1 -1 26 26" {...props}>
      <path d={TIKTOK_PATH} fill="#25F4EE" transform="translate(-0.9 -0.9)" />
      <path d={TIKTOK_PATH} fill="#FE2C55" transform="translate(0.9 0.9)" />
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
