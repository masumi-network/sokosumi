export interface AuthCustomerLogo {
  src: string;
  alt: string;
  width: number;
  height: number;
}

const WORDMARK_HEIGHT = 16;
const MARK_HEIGHT = 20;

function size(
  intrinsicWidth: number,
  intrinsicHeight: number,
  height: number,
): Pick<AuthCustomerLogo, "width" | "height"> {
  return {
    height,
    width: Math.round((intrinsicWidth / intrinsicHeight) * height),
  };
}

/** Customer marks from sokosumi.com — one quiet row on the dark auth panel. */
export const AUTH_CUSTOMER_LOGOS: AuthCustomerLogo[] = [
  {
    src: "/images/logos/customers/telekom.svg",
    alt: "Deutsche Telekom",
    ...size(34, 40, MARK_HEIGHT),
  },
  {
    src: "/images/logos/customers/allianz.svg",
    alt: "Allianz",
    ...size(127, 33, WORDMARK_HEIGHT),
  },
  {
    src: "/images/logos/customers/lufthansa.svg",
    alt: "Lufthansa",
    ...size(155, 27, WORDMARK_HEIGHT),
  },
  {
    src: "/images/logos/customers/ard.svg",
    alt: "ARD",
    ...size(101, 44, MARK_HEIGHT),
  },
  {
    src: "/images/logos/customers/tdk.svg",
    alt: "TDK",
    ...size(110, 24, WORDMARK_HEIGHT),
  },
  {
    src: "/images/logos/customers/stroer.svg",
    alt: "Ströer",
    ...size(155, 36, WORDMARK_HEIGHT),
  },
  {
    src: "/images/logos/customers/bsh.svg",
    alt: "B/S/H/",
    ...size(88, 20, WORDMARK_HEIGHT),
  },
  {
    src: "/images/logos/customers/bvg.svg",
    alt: "BVG",
    ...size(67, 60, MARK_HEIGHT),
  },
  {
    src: "/images/logos/customers/ravensburger.svg",
    alt: "Ravensburger",
    ...size(80, 80, MARK_HEIGHT),
  },
  {
    src: "/images/logos/customers/samsung.svg",
    alt: "Samsung",
    ...size(94, 15, WORDMARK_HEIGHT),
  },
];

/** Builder mark — sits with the Haller quote, and in the cycling ticker. */
export const AUTH_SERVICEPLAN_LOGO: AuthCustomerLogo = {
  src: "/images/logos/serviceplan-logo-white.png",
  alt: "Serviceplan Group",
  ...size(360, 56, 14),
};

/** Full ticker set from sokosumi.com plus remaining logo-folder marks. */
export const AUTH_MARQUEE_LOGOS: AuthCustomerLogo[] = [
  ...AUTH_CUSTOMER_LOGOS,
  AUTH_SERVICEPLAN_LOGO,
];
