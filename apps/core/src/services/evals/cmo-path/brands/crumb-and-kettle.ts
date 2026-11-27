import type { CmoPathBrand } from "../types";
import { page } from "./page";

const STYLE = {
  primary: "#8a3b12",
  accent: "#f2c14e",
  ink: "#2b1d14",
  font: "'Fraunces', Georgia, serif",
};

/** A fictional neighbourhood bakery-café: picture-led, local, three networks. */
export const CRUMB_AND_KETTLE: CmoPathBrand = {
  id: "crumb-and-kettle",
  domain: "crumbandkettle.example",
  eval: {
    name: "Crumb & Kettle",
    url: "https://crumbandkettle.example/",
    goal: "More people come in on weekday mornings",
    main: "bak|bun|bread|café|cafe|coffee",
    price: "3[.,]20",
    siteLanguage: "en",
  },
  facts: [
    { label: "the cardamom bun", pattern: "cardamom" },
    { label: "the bun's price", pattern: "£\\s?3[.,]20" },
    { label: "the neighbourhood", pattern: "Chapel Allerton|Leeds" },
    { label: "the opening hours", pattern: "7(:00)?\\s?(am|a\\.m\\.)|07:00" },
    { label: "the sourdough", pattern: "sourdough" },
  ],
  colors: [STYLE.primary, STYLE.accent],
  owner: {
    firstName: "Priya",
    lastName: "Hallworth",
    timeZone: "Europe/London",
  },
  ownerBrief: [
    "You run Crumb & Kettle, a bakery-café in Chapel Allerton, Leeds, opened in 2019.",
    "You bake sourdough every morning; the cardamom bun (£3.20) is the best seller; flat white £3.10; sourdough loaf £4.80.",
    "Open Tuesday to Sunday, 7am to 3pm, closed Mondays. Weekday mornings are quiet and that is what you want to fix.",
    "Your customers are locals: commuters, parents after the school run, people working from home.",
    "You post on Instagram, Facebook and TikTok. Short videos of the bake are fine, you can film on your phone.",
    "You have a small ad budget of £150 this month for local ads.",
  ].join(" "),
  networks: ["instagram", "facebook", "tiktok"],
  pages: [
    page(
      "/",
      "Crumb & Kettle | Bakery and café in Chapel Allerton, Leeds",
      STYLE,
      [
        "<h1>Baked this morning, in Chapel Allerton</h1>",
        "<p>Crumb & Kettle is a neighbourhood bakery-café in Leeds. We bake sourdough and pastries every morning from 5am, and the doors open at 7am.</p>",
        "<p>Try the cardamom bun, our best seller, with a flat white.</p>",
        "<p>Open Tuesday to Sunday, 7am to 3pm. Closed Mondays.</p>",
        "<p><a href='https://www.instagram.com/crumbandkettle.example'>Instagram</a> · <a href='https://www.facebook.com/crumbandkettle.example'>Facebook</a> · <a href='https://www.tiktok.com/@crumbandkettle.example'>TikTok</a></p>",
      ],
    ),
    page("/menu", "Menu | Crumb & Kettle", STYLE, [
      "<h1>Menu</h1>",
      "<ul><li>Cardamom bun: £3.20</li><li>Cinnamon knot: £3.20</li><li>Almond croissant: £3.60</li>",
      "<li>Sourdough loaf: £4.80</li><li>Flat white: £3.10</li><li>Filter coffee: £2.60</li></ul>",
      "<p>Everything is baked on site. Ask us about allergens.</p>",
    ]),
    page("/about", "About | Crumb & Kettle", STYLE, [
      "<h1>About us</h1>",
      "<p>Priya opened Crumb & Kettle in 2019 after ten years in London bakeries. Two ovens, one long table, and a kettle that never stops.</p>",
    ]),
    page(
      "/journal/our-sourdough",
      "How we make our sourdough | Crumb & Kettle",
      STYLE,
      [
        "<h1>How we make our sourdough</h1>",
        "<p>Our starter is six years old. Each loaf proves for 18 hours and goes into the oven at 5am, so it is still warm when we open.</p>",
      ],
    ),
    {
      path: "/logo.svg",
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40" viewBox="0 0 160 40"><circle cx="20" cy="20" r="18" fill="${STYLE.primary}"/><circle cx="20" cy="20" r="8" fill="${STYLE.accent}"/><text x="46" y="27" font-family="Georgia" font-size="18" fill="${STYLE.ink}">Crumb &amp; Kettle</text></svg>`,
    },
  ],
  change: {
    kind: "drop-network",
    message:
      "Let's stop TikTok for the rest of the month, it's too much for us right now. Keep Instagram and Facebook as they are.",
    selector: { network: "tiktok" },
  },
  analytics: {
    winner: { network: "instagram", kinds: ["video"] },
    factor: 4,
    winnerWords: ["instagram", "reel", "video"],
  },
};
