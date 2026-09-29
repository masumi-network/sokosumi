import { type ComponentProps, useId } from "react";

interface SocialIconProps {
  size?: string | number | undefined;
  color?: string | undefined;
}

const defaultProps: SocialIconProps = {
  size: "26px",
  color: "#FFFFFF",
};

export function GoogleIcon({ size = defaultProps.size }: SocialIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
    >
      <linearGradient
        id="95yY7w43Oj6n2vH63j6HJb"
        x1="29.401"
        x2="29.401"
        y1="4.064"
        y2="106.734"
        gradientTransform="matrix(1 0 0 -1 0 66)"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0" stopColor="#ff5840" />
        <stop offset=".007" stopColor="#ff5840" />
        <stop offset=".989" stopColor="#fa528c" />
        <stop offset="1" stopColor="#fa528c" />
      </linearGradient>
      <path
        fill="url(#95yY7w43Oj6n2vH63j6HJb)"
        d="M47.46,15.5l-1.37,1.48c-1.34,1.44-3.5,1.67-5.15,0.6c-2.71-1.75-6.43-3.13-11-2.37	c-4.94,0.83-9.17,3.85-11.64,
          7.97l-8.03-6.08C14.99,9.82,23.2,5,32.5,5c5,0,9.94,1.56,14.27,4.46	C48.81,10.83,49.13,13.71,47.46,15.5z"
      />
      <linearGradient
        id="95yY7w43Oj6n2vH63j6HJc"
        x1="12.148"
        x2="12.148"
        y1=".872"
        y2="47.812"
        gradientTransform="matrix(1 0 0 -1 0 66)"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0" stopColor="#feaa53" />
        <stop offset=".612" stopColor="#ffcd49" />
        <stop offset="1" stopColor="#ffde44" />
      </linearGradient>
      <path
        fill="url(#95yY7w43Oj6n2vH63j6HJc)"
        d="M16.01,30.91c-0.09,2.47,0.37,4.83,1.27,6.96l-8.21,6.05c-1.35-2.51-2.3-5.28-2.75-8.22	c-1.06-6.88,0.54-13.38,
          3.95-18.6l8.03,6.08C16.93,25.47,16.1,28.11,16.01,30.91z"
      />
      <linearGradient
        id="95yY7w43Oj6n2vH63j6HJd"
        x1="29.76"
        x2="29.76"
        y1="32.149"
        y2="-6.939"
        gradientTransform="matrix(1 0 0 -1 0 66)"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0" stopColor="#42d778" />
        <stop offset=".428" stopColor="#3dca76" />
        <stop offset="1" stopColor="#34b171" />
      </linearGradient>
      <path
        fill="url(#95yY7w43Oj6n2vH63j6HJd)"
        d="M50.45,51.28c-4.55,4.07-10.61,6.57-17.36,6.71C22.91,58.2,13.66,52.53,9.07,43.92l8.21-6.05	C19.78,43.81,
          25.67,48,32.5,48c3.94,0,7.52-1.28,10.33-3.44L50.45,51.28z"
      />
      <linearGradient
        id="95yY7w43Oj6n2vH63j6HJe"
        x1="46"
        x2="46"
        y1="3.638"
        y2="35.593"
        gradientTransform="matrix(1 0 0 -1 0 66)"
        gradientUnits="userSpaceOnUse"
      >
        <stop offset="0" stopColor="#155cde" />
        <stop offset=".278" stopColor="#1f7fe5" />
        <stop offset=".569" stopColor="#279ceb" />
        <stop offset=".82" stopColor="#2cafef" />
        <stop offset="1" stopColor="#2eb5f0" />
      </linearGradient>
      <path
        fill="url(#95yY7w43Oj6n2vH63j6HJe)"
        d="M59,31.97c0.01,7.73-3.26,14.58-8.55,19.31l-7.62-6.72c2.1-1.61,3.77-3.71,4.84-6.15
          c0.29-0.66-0.2-1.41-0.92-1.41H37c-2.21,0-4-1.79-4-4v-2c0-2.21,1.79-4,4-4h17C56.75,27,59,29.22,59,31.97z"
      />
    </svg>
  );
}

export function MicrosoftIcon({
  size = defaultProps.size,
  color = defaultProps.color,
}: SocialIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill={color}
      x="0px"
      y="0px"
      viewBox="0 0 48 48"
    >
      <path fill="#ff5722" d="M6 6H22V22H6z" transform="rotate(-180 14 14)" />
      <path fill="#4caf50" d="M26 6H42V22H26z" transform="rotate(-180 34 14)" />
      <path
        fill="#ffc107"
        d="M26 26H42V42H26z"
        transform="rotate(-180 34 34)"
      />
      <path fill="#03a9f4" d="M6 26H22V42H6z" transform="rotate(-180 14 34)" />
    </svg>
  );
}

// Brand marks for Project social accounts. Glyphs are Simple Icons paths
// (LinkedIn is Font Awesome's, since Simple Icons dropped it); the colors are
// each network's own. X and the TikTok note follow the text color, as their
// guidelines allow only black or white there.

type BrandIconProps = ComponentProps<"svg">;

const TIKTOK_PATH =
  "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z";

export function TikTokIcon(props: BrandIconProps) {
  return (
    <svg viewBox="-1 -1 26 26" {...props}>
      <path d={TIKTOK_PATH} fill="#25F4EE" transform="translate(-0.9 -0.9)" />
      <path d={TIKTOK_PATH} fill="#FE2C55" transform="translate(0.9 0.9)" />
      <path d={TIKTOK_PATH} fill="currentColor" />
    </svg>
  );
}

export function InstagramIcon(props: BrandIconProps) {
  const gradientId = `instagram-gradient-${useId()}`;
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
      <path
        fill={`url(#${gradientId})`}
        d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077"
      />
    </svg>
  );
}

export function LinkedInIcon(props: BrandIconProps) {
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

export function FacebookIcon(props: BrandIconProps) {
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

export function YouTubeIcon(props: BrandIconProps) {
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
