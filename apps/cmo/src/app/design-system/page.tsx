import "../../components/onboarding/onboarding.css";
import "./design-system.css";

import {
  type CusoArt,
  CusoAvatar,
  type Pose as CusoPose,
  cusoArt,
} from "../../components/cuso";
import { type Lockup, Logo } from "../../components/logo";
import { StatusDisc } from "../../components/status";
import { AGENT_NAME } from "../../lib/agent";
import { previewOnly } from "./fixture-frame";
import { PartsPreview } from "./parts-preview";

/**
 * Preview of the design system (`apps/cmo/design-system.md`): tokens and the
 * real base classes, once in light and once in dark, side by side. Local and
 * preview deploys only; production does not serve it.
 */

type Scheme = "light" | "dark";

const LOCKUPS: [Lockup, string][] = [
  ["stacked", "Stacked: the header"],
  ["primary", "Primary: the pages around sign in"],
  ["framed", "Framed panel: the 404"],
  ["block", "Knockout block: the error page"],
];

const RULES = [
  "Thick lines do the work.",
  "A hard shadow means you can act.",
  "Iris means now, and picked.",
  "Bold speaks, Regular works.",
  "Black strips for contrast.",
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
  file: CusoPose;
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

/** The two steps the onboarding screens already style. */
const TYPE_CLASS: Record<string, string> = {
  display: "ob-display",
  h1: "ob-h1",
};

const TYPE: TypeStep[] = [
  { step: "display", sample: "Marketing, handled" },
  { step: "h1", sample: "Your strategy for May" },
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
  { name: "Pill", token: "--radius-pill" },
];

const SHADOWS = [
  { name: "Shadow", className: "ds-shadow" },
  { name: "Big shadow", className: "ds-shadow-big" },
];

const ART: CusoArt[] = [
  "walking",
  "pointing",
  "thinking",
  "thumbs-up",
  "searching",
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
      <p className="ds-t-small muted">
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
        <ul className="ds-logos">
          {LOCKUPS.map(([lockup, use]) => (
            <li key={lockup}>
              <Logo lockup={lockup} />
              <span className="ds-t-small ds-muted">{use}</span>
            </li>
          ))}
        </ul>
        <p className="ds-t-small ds-muted">
          Each lockup on the background the brand guide approves: the file for
          white on a light page, the one for black on a dark page.
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
                <span className="ds-t-small muted">{swatch.token}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Type">
        <ul className="ds-type">
          {TYPE.map((row) => (
            <li key={row.step}>
              <span className="ds-t-micro muted">{row.step}</span>
              <p className={TYPE_CLASS[row.step] ?? `ds-t-${row.step}`}>
                {row.sample}
              </p>
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
          {SHADOWS.map((shadow) => (
            <li key={shadow.name}>
              <span className={`ds-radius-box ${shadow.className}`} />
              <span className="ds-t-small">{shadow.name}</span>
            </li>
          ))}
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
          <span id={`ds-help-${scheme}`} className="ds-t-small muted">
            The address people visit today.
          </span>
        </div>
      </Section>

      <Section title="Layers">
        <div className="panel">
          <div className="card ds-card-body">
            <p className="ds-t-h2">White page, outlined panel, outlined card</p>
            <p className="ds-t-small muted">
              A black strip crosses the page where contrast helps.
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
            <StatusDisc status="ok" />
            <span className="ds-t-small">Done</span>
          </li>
          <li>
            <StatusDisc status="warn" />
            <span className="ds-t-small">Needs you</span>
          </li>
          <li>
            <StatusDisc status="fail" />
            <span className="ds-t-small">Failed</span>
          </li>
        </ul>
      </Section>

      <Section title={AGENT_NAME}>
        <ul className="ds-poses">
          {POSES.map((pose) => (
            <li key={pose.file}>
              <CusoAvatar pose={pose.file} size={48} />
              <span
                className={`ds-t-small${pose.file === "needs-you" ? " ds-pose-on-iris" : ""}`}
              >
                {pose.label}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Components">
        <PartsPreview />
      </Section>

      <Section title="Poses">
        <ul className="ds-scenes">
          {ART.map((art) => (
            <li key={art}>
              <img src={cusoArt(art)} alt="" width={160} height={160} />
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Hero stage">
        <div className="ds-stage">
          <img
            className="ds-stage-art"
            src={cusoArt("walking")}
            alt="Cuso walking"
            width={200}
            height={200}
          />
          <span className="ob-tilt ob-tilt-a">Reads your site</span>
          <span className="ob-tilt ob-tilt-b">Writes the month</span>
          <span className="ob-tilt ob-tilt-c">Asks when unsure</span>
        </div>
      </Section>
    </div>
  );
}

export default function DesignSystemPage() {
  previewOnly();
  return (
    <main className="ds">
      <h1 className="ob-h1">Design system</h1>
      <div className="ds-columns">
        <Board scheme="light" />
        <Board scheme="dark" />
      </div>
    </main>
  );
}
