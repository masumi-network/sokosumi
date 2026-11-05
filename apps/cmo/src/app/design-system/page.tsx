import "./design-system.css";

import { notFound } from "next/navigation";

/**
 * Preview of the design system (`apps/cmo/design-system.md`): tokens and the
 * real base classes, once in light and once in dark, side by side. Local and
 * preview deploys only; production does not serve it.
 */

type Scheme = "light" | "dark";

const RULES = [
  "Lines do the work.",
  "One hard shadow.",
  "Iris means now.",
  "Bold speaks, Regular works.",
  "Three layers.",
];

/** Values without the hash, so the page itself holds no colour literal. */
const SWATCHES: {
  name: string;
  token: string;
  light: string;
  dark: string;
}[] = [
  { name: "Page", token: "--background", light: "FFFFFF", dark: "0C0C0C" },
  { name: "Panel", token: "--surface", light: "F5F5F5", dark: "171717" },
  { name: "Card", token: "--card", light: "FFFFFF", dark: "0C0C0C" },
  { name: "Text", token: "--foreground", light: "171717", dark: "FAFAFA" },
  { name: "Muted text", token: "--muted", light: "525252", dark: "A3A3A3" },
  { name: "Ink line", token: "--line", light: "0C0C0C", dark: "A3A3A3" },
  { name: "Hairline", token: "--border", light: "E5E5E5", dark: "262626" },
  { name: "Iris", token: "--primary", light: "FF51FF", dark: "D141D1" },
  {
    name: "Iris hover",
    token: "--primary-hover",
    light: "FF51FF",
    dark: "FF51FF",
  },
  {
    name: "On Iris",
    token: "--primary-foreground",
    light: "0C0C0C",
    dark: "0C0C0C",
  },
  { name: "Peach", token: "--peach", light: "FFC8F0", dark: "FFC8F0" },
  { name: "Done", token: "--ok", light: "00D43B", dark: "00D43B" },
  { name: "Needs an answer", token: "--warn", light: "FFD300", dark: "FFD300" },
];

const TYPE: { step: string; spec: string; sample: string }[] = [
  { step: "display", spec: "72 / 68, 800", sample: "Marketing, handled" },
  { step: "h1", spec: "36 / 38, 800", sample: "Your plan for May" },
  {
    step: "statement",
    spec: "28 / 32, 300",
    sample: "Reach 500 new readers this month",
  },
  { step: "value", spec: "24 / 28, 300", sample: "Does this sound like you?" },
  { step: "h2", spec: "16 / 20, 600", sample: "This week" },
  {
    step: "body",
    spec: "14 / 18, 400",
    sample: "Three posts are written and scheduled.",
  },
  { step: "small", spec: "12 / 16, 400", sample: "Updated 2 minutes ago" },
  { step: "micro", spec: "11 / 14, 400", sample: "Source: your homepage" },
];

const RADII = [
  { name: "Mark", token: "--radius-mark", px: 6 },
  { name: "Control", token: "--radius-control", px: 8 },
  { name: "Card", token: "--radius-card", px: 10 },
  { name: "Panel", token: "--radius-panel", px: 14 },
];

const POSES = [
  { file: "reading", label: "Reading", alt: "Cuso reading" },
  { file: "thinking", label: "Thinking", alt: "Cuso thinking" },
  { file: "needs-you", label: "Needs you", alt: "Cuso asking for an answer" },
  { file: "reporting", label: "Reporting", alt: "Cuso reporting" },
  { file: "done", label: "Done", alt: "Cuso finished" },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="ds-section">
      <h2 className="ds-h2">{title}</h2>
      {children}
    </section>
  );
}

function Board({ scheme }: { scheme: Scheme }) {
  return (
    <div className={`ds-board theme-scope ${scheme}`}>
      <p className="ds-small ds-muted">
        {scheme === "light" ? "Light" : "Dark"}
      </p>

      <Section title="Five rules">
        <ol className="ds-rules">
          {RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
      </Section>

      <Section title="Colour">
        <ul className="ds-swatches">
          {SWATCHES.map((swatch) => (
            <li key={swatch.token} className="ds-swatch">
              <span
                className="ds-chip-fill"
                style={{ background: `var(${swatch.token})` }}
              />
              <span className="ds-swatch-text">
                <span className="ds-body-medium">{swatch.name}</span>
                <span className="ds-small ds-muted">
                  {swatch.token} {`#${swatch[scheme]}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Type">
        <ul className="ds-type">
          {TYPE.map((row) => (
            <li key={row.step}>
              <span className="ds-micro ds-muted">
                {row.step} {row.spec}
              </span>
              <p className={`ds-t-${row.step}`}>{row.sample}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Radii and shadow">
        <ul className="ds-radii">
          {RADII.map((radius) => (
            <li key={radius.token}>
              <span
                className={`ds-radius-box ds-r-${radius.name.toLowerCase()}`}
              />
              <span className="ds-small">
                {radius.name} {radius.px}px
              </span>
            </li>
          ))}
          <li>
            <span className="ds-radius-box ds-shadow-box" />
            <span className="ds-small">Hard shadow</span>
          </li>
        </ul>
      </Section>

      <Section title="Buttons">
        <div className="actions">
          <button type="button" className="button">
            Start reading
          </button>
          <button type="button" className="button button-secondary">
            Not yet
          </button>
          <button
            type="button"
            className="button button-secondary button-small"
          >
            Details
          </button>
          <button
            type="button"
            className="button button-secondary button-small"
            aria-pressed="true"
          >
            Open
          </button>
          <button type="button" className="button button-ghost button-small">
            Skip for now
          </button>
        </div>
      </Section>

      <Section title="Input">
        <div className="field">
          <label htmlFor={`ds-url-${scheme}`}>Your website</label>
          <input
            id={`ds-url-${scheme}`}
            type="text"
            placeholder="example.com"
            aria-describedby={`ds-help-${scheme}`}
          />
          <span id={`ds-help-${scheme}`} className="ds-small ds-muted">
            The address people visit today.
          </span>
        </div>
      </Section>

      <Section title="Three layers">
        <div className="panel">
          <div className="card ds-card-body">
            <p className="ds-h2">White page, gray panel, outlined card</p>
            <p className="ds-small ds-muted">
              A card sits on a panel, never straight on the page.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Status">
        <ul className="ds-status">
          <li>
            <span role="img" aria-label="Done" className="ds-disc ds-disc-ok">
              <span aria-hidden="true">✓</span>
            </span>
            <span className="ds-small">Done</span>
          </li>
          <li>
            <span
              role="img"
              aria-label="Needs your answer"
              className="ds-disc ds-disc-warn"
            >
              <span aria-hidden="true">!</span>
            </span>
            <span className="ds-small">Needs you</span>
          </li>
          <li>
            <span
              role="img"
              aria-label="Failed"
              className="ds-disc ds-disc-fail"
            >
              <span aria-hidden="true">✕</span>
            </span>
            <span className="ds-small">Failed</span>
          </li>
        </ul>
      </Section>

      <Section title="Cuso">
        <ul className="ds-poses">
          {POSES.map((pose) => (
            <li key={pose.file}>
              <span className="ds-avatar">
                <img
                  src={`/cuso/${pose.file}.png`}
                  alt=""
                  width={48}
                  height={48}
                />
              </span>
              <span
                className={`ds-small${pose.file === "needs-you" ? " ds-pose-on-iris" : ""}`}
              >
                {pose.label}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Hero stage">
        <div className="ds-stage">
          <img
            className="ds-stage-art"
            src="/cuso/hero.jpg"
            alt="Cuso walking with a megaphone"
            width={200}
            height={300}
          />
          <span className="ds-tilt ds-tilt-a">Reads your site</span>
          <span className="ds-tilt ds-tilt-b">Writes the month</span>
          <span className="ds-tilt ds-tilt-c">Asks when unsure</span>
        </div>
      </Section>
    </div>
  );
}

export default function DesignSystemPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return (
    <main className="ds">
      <h1 className="ds-title">Design system</h1>
      <div className="ds-columns">
        <Board scheme="light" />
        <Board scheme="dark" />
      </div>
    </main>
  );
}
