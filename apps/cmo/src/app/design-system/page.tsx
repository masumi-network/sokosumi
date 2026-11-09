import "./design-system.css";

import { notFound } from "next/navigation";

import { Logo } from "../../components/logo";
import { isDesignSystemPublic } from "./access";

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

interface Swatch {
  name: string;
  token: string;
}

interface TypeStep {
  step: string;
  sample: string;
}

interface Radius {
  name: string;
  token: string;
}

interface Pose {
  file: string;
  label: string;
}

const SWATCHES: Swatch[] = [
  { name: "Page", token: "--background" },
  { name: "Panel", token: "--surface" },
  { name: "Card", token: "--card" },
  { name: "Text", token: "--foreground" },
  { name: "Muted text", token: "--muted" },
  { name: "Ink line", token: "--line" },
  { name: "Hairline", token: "--border" },
  { name: "Iris", token: "--primary" },
  { name: "Iris hover", token: "--primary-hover" },
  { name: "On Iris", token: "--primary-foreground" },
  { name: "Peach", token: "--peach" },
  { name: "Done", token: "--ok" },
  { name: "Needs an answer", token: "--warn" },
  { name: "Cuso stage", token: "--stage" },
  { name: "Modal scrim", token: "--scrim" },
];

const TYPE: TypeStep[] = [
  { step: "display", sample: "Marketing, handled" },
  { step: "h1", sample: "Your plan for May" },
  { step: "statement", sample: "Reach 500 new readers this month" },
  { step: "value", sample: "Does this sound like you?" },
  { step: "h2", sample: "This week" },
  { step: "body", sample: "Three posts are written and scheduled." },
  { step: "small", sample: "Updated 2 minutes ago" },
  { step: "micro", sample: "Source: your homepage" },
];

const RADII: Radius[] = [
  { name: "Mark", token: "--radius-mark" },
  { name: "Control", token: "--radius-control" },
  { name: "Card", token: "--radius-card" },
  { name: "Panel", token: "--radius-panel" },
];

const POSES: Pose[] = [
  { file: "reading", label: "Reading" },
  { file: "thinking", label: "Thinking" },
  { file: "needs-you", label: "Needs you" },
  { file: "reporting", label: "Reporting" },
  { file: "done", label: "Done" },
];

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <section className="ds-section">
      <h2 className="ds-t-h2">{title}</h2>
      {children}
    </section>
  );
}

interface BoardProps {
  scheme: Scheme;
}

function Board({ scheme }: BoardProps) {
  return (
    <div className={`ds-board theme-scope ${scheme}`}>
      <p className="ds-t-small ds-muted">
        {scheme === "light" ? "Light" : "Dark"}
      </p>

      <Section title="Five rules">
        <ol className="ds-rules">
          {RULES.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
      </Section>

      <Section title="Logo">
        <p className="ds-logo">
          <Logo />
        </p>
        <p className="ds-t-small ds-muted">
          16px high in a header, drawn in the text colour.
        </p>
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
                <span className="ds-t-small ds-muted">{swatch.token}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Type">
        <ul className="ds-type">
          {TYPE.map((row) => (
            <li key={row.step}>
              <span className="ds-t-micro ds-muted">{row.step}</span>
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
              <span className="ds-t-small">{radius.name}</span>
            </li>
          ))}
          <li>
            <span className="ds-radius-box ds-shadow-box" />
            <span className="ds-t-small">Hard shadow</span>
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
          <span id={`ds-help-${scheme}`} className="ds-t-small ds-muted">
            The address people visit today.
          </span>
        </div>
      </Section>

      <Section title="Three layers">
        <div className="panel">
          <div className="card ds-card-body">
            <p className="ds-t-h2">White page, gray panel, outlined card</p>
            <p className="ds-t-small ds-muted">
              A card sits on a panel, never straight on the page.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Checklist">
        <ul className="ds-checklist">
          <li className="ds-check done">
            <span className="ds-check-box" aria-hidden="true">
              ✓
            </span>
            <span className="ds-t-small">Read your homepage</span>
          </li>
          <li className="ds-check working">
            <span className="ds-check-box" aria-hidden="true">
              ·
            </span>
            <span className="ds-t-small">Compare competitors</span>
          </li>
          <li className="ds-check">
            <span className="ds-check-box" aria-hidden="true" />
            <span className="ds-t-small">Draft your first month</span>
          </li>
        </ul>
      </Section>

      <Section title="Skeleton">
        <div className="ds-skeleton" aria-hidden="true">
          <span className="ds-skel-bar" />
          <span className="ds-skel-bar short" />
          <span className="ds-skel-bar" />
        </div>
      </Section>

      <Section title="Status">
        <ul className="ds-status">
          <li>
            <span role="img" aria-label="Done" className="ds-disc ds-disc-ok">
              <span aria-hidden="true">✓</span>
            </span>
            <span className="ds-t-small">Done</span>
          </li>
          <li>
            <span
              role="img"
              aria-label="Needs your answer"
              className="ds-disc ds-disc-warn"
            >
              <span aria-hidden="true">!</span>
            </span>
            <span className="ds-t-small">Needs you</span>
          </li>
          <li>
            <span
              role="img"
              aria-label="Failed"
              className="ds-disc ds-disc-fail"
            >
              <span aria-hidden="true">✕</span>
            </span>
            <span className="ds-t-small">Failed</span>
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
                className={`ds-t-small${pose.file === "needs-you" ? " ds-pose-on-iris" : ""}`}
              >
                {pose.label}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Scenes">
        <ul className="ds-scenes">
          <li>
            <img
              src="/cuso/reading-scene.jpg"
              alt="Cuso reading a site with a magnifier"
              width={160}
              height={160}
            />
          </li>
          <li>
            <img
              src="/cuso/celebration.jpg"
              alt="Cuso celebrating next to a toy rocket"
              width={160}
              height={160}
            />
          </li>
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
  if (
    !isDesignSystemPublic({
      VERCEL_ENV: process.env.VERCEL_ENV,
      NODE_ENV: process.env.NODE_ENV,
    })
  ) {
    notFound();
  }
  return (
    <main className="ds">
      <h1 className="ds-t-h1">Design system</h1>
      <div className="ds-columns">
        <Board scheme="light" />
        <Board scheme="dark" />
      </div>
    </main>
  );
}
