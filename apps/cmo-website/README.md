# CMO.XYZ website

Landing page for **CMO.XYZ**, the AI CMO. The agent is named Cuso. See
`PROJECT.md` for what he does and how to talk about him.

Deployed by the Vercel project `cmo-website` to https://www.cmo.xyz from
`apps/cmo-website` in this monorepo. Agent rules: `AGENTS.md`.

## Run it

No build step. Vercel serves `public/` and the function in `api/`. Serve it:

```bash
python3 -m http.server 8000 --directory public
# then open http://localhost:8000
```

## Files

Site files live in `public/`; `api/`, `legal/` and `scripts/` sit beside it and
are not served.

- `index.html`: the page. Sections: nav, hero, marquee, "A month with Cuso"
  (five steps with example strategy, posts, ad, schedule and weekly check),
  pricing, FAQ, final CTA, footer with legal links, privacy choices and disclosures.
- `styles.css`: all styles. Colors, fonts and sizes are tokens in `:root`.
- `script.js`: sends the GA `cta_click` event, animates Cuso in the hero
  and reveals sections on scroll. Cuso walks in from the back of the page,
  turns to wave, waves now and then and wobbles when pressed; his legs are
  drawn live so his feet stay planted.
  All motion is off under `prefers-reduced-motion`, where the hero shows
  `assets/cuso/friendly.svg` instead.
- `assets/cuso/`: Cuso from the brand guide's `Cuso 2D Mascot` folder. The
  step poses and `friendly.svg` are its `-ground-shadow` SVGs, and the
  `*-white-outline.svg` files its `-ground-shadow-white-outline` SVGs for dark,
  all copied unchanged. `poses.svg` is the hero's animated Cuso, made from its
  `-default` SVGs by `python3 scripts/cuso-poses.py "<brand guide>/Cuso 2D Mascot"`;
  re-run it when the poses change, then check the hero in a browser.
- `assets/`: also the logos (`assets/logo/`), icons and fonts.
  The logos and `icon.svg` are copied unchanged from the
  [Masumi Family Brand Guide](https://github.com/masumi-network/Masumi-Family-Brand-Guide)
  (`logos/cmo-xyz/`); use each only on its approved background.

## Look

Neo-brutalist: white and black with one accent (`#FF51FF`),
3px black lines, hard 4px shadows on things you can click, and pill tags.
The line, shadow and radius scale is shared with the app (see `PROJECT.md`,
decision 10) and lives as tokens in `:root`. Headings are PP Mori
600, body text is Inter. Both fonts are served from `assets/fonts/`.

The footer toggle cycles System, Light and Dark; Light and Dark are saved in
`localStorage`, System follows the visitor's setting live. Dark uses the app's
dark tokens: `--ink` and `--paper` swap, lines and hard shadows follow `--edge`
(light in dark), Iris rests at `#D141D1` and brightens on hover, and the black
bands go true black. Text on Iris stays black; the cards on the Iris bands
stay dark. Cuso and the final logo have a dark file from the brand guide
(`-white-outline` poses, `mascot-top-white`), paired with the light one by the
`on-light` / `on-dark` classes; the animated hero Cuso gets the same white edge in CSS.

## Sign up

Main CTAs go to https://app.cmo.xyz/signup.

## Keeping the copy true

The example business, Moss & Kettle, is made up and labelled as such. Prices
are the app's Polar plans (Starter, Growth, Scale). If the plans change in
Polar, change them in the pricing section and the FAQ.

## Legal pages and cookie choices

The Markdown in `legal/` is the source for `/terms`, `/privacy`, `/imprint`
and `/dpa`. All company details come from `legal/company.json`; change them
there rather than editing generated HTML. The DPA is incorporated into the
Terms for customer-directed processing. The site remains static.

```bash
python3 scripts/render-legal.py
python3 scripts/render-legal.py --check
node --test scripts/test-cookie-consent.mjs
```

The EU representative is listed by name and email. VAT information is
omitted because Sumico has no VAT ID. Before publication, require the
rendered pages in `public/` and company facts to pass:

```bash
python3 scripts/render-legal.py --check --release-check
```

`cookie-consent.js` asks `/api/geo` (`api/geo.js`, Vercel's
`x-vercel-ip-country` header) whether the visitor needs to consent. In the
EU/EEA, UK and Switzerland, or when the country is unknown, Google Analytics
waits for an explicit choice in a small banner. Elsewhere it loads by default.
Global Privacy Control or an opt-out turns it off everywhere, and an opt-out
does not expire. "Your Privacy Choices" in the footer reopens the choice. Legal pages do not load analytics.
Consent is stored separately for each browser origin for 180 days.
