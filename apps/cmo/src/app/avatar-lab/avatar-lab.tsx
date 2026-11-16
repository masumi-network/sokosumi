"use client";

import type { AvatarMotion } from "open-bot-avatar";
import { useState } from "react";

import { BotAvatar } from "../../components/bot-avatar";
import { CUSO_POINTER } from "../../components/cuso-pointer-avatar";
import {
  FlatCuso,
  type FlatCusoPose,
  type FlatCusoVariant,
} from "../../components/flat-cuso";

/** One state drives both: the bot's mood and Flat Cuso's pose. */
const STATES: { mood: AvatarMotion; pose: FlatCusoPose; label: string }[] = [
  { mood: "idle", pose: "stand", label: "Idle" },
  { mood: "thinking", pose: "point", label: "Thinking" },
  { mood: "happy", pose: "wave", label: "Happy" },
];
const VARIANTS: { value: FlatCusoVariant; label: string }[] = [
  { value: "line", label: "Line" },
  { value: "solid", label: "Solid" },
];
const SIZES = [96, 64, 40, 28, 20];

/** Test bench: Flat Cuso as SVG next to open-bot-avatar. Not linked from the app. */
export function AvatarLab() {
  const [state, setState] = useState(STATES[1]);
  const [variant, setVariant] = useState<FlatCusoVariant>("line");
  const [depth, setDepth] = useState(6);
  const [lively, setLively] = useState(true);

  const bot = {
    definition: CUSO_POINTER,
    color: "var(--foreground)",
    eyeColor: "var(--background)",
    mood: state.mood,
    depth,
    followPointer: lively,
  };

  return (
    <main className="lab">
      <div className="lab-intro">
        <p className="eyebrow">Avatar lab</p>
        <h1 className="lab-title">Flat Cuso, two ways</h1>
        <p className="lead">
          Left is the 2D system drawn as SVG. Right is the same body on
          open-bot-avatar, which fills one silhouette and animates the eyes.
        </p>
      </div>

      <div className="lab-grid">
        <figure className="lab-panel">
          <div className="lab-stage">
            <FlatCuso
              size={280}
              pose={state.pose}
              variant={variant}
              lively={lively}
              label="Cuso"
            />
          </div>
          <figcaption>SVG · pose and blink</figcaption>
        </figure>

        <figure className="lab-panel">
          <div className="lab-stage">
            <BotAvatar size={280} label="Cuso" {...bot} />
          </div>
          <figcaption>open-bot-avatar · solid, depth and mood</figcaption>
        </figure>

        <form
          className="lab-controls"
          onSubmit={(event) => event.preventDefault()}
        >
          <fieldset className="lab-field">
            <legend>State</legend>
            <div className="lab-segments">
              {STATES.map((option) => (
                <label key={option.mood} className="lab-segment">
                  <input
                    type="radio"
                    name="state"
                    checked={state === option}
                    onChange={() => setState(option)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="lab-field">
            <legend>SVG style</legend>
            <div className="lab-segments">
              {VARIANTS.map((option) => (
                <label key={option.value} className="lab-segment">
                  <input
                    type="radio"
                    name="variant"
                    checked={variant === option.value}
                    onChange={() => setVariant(option.value)}
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="lab-field">
            <span>Bot depth {depth}</span>
            <input
              type="range"
              min={0}
              max={14}
              value={depth}
              onChange={(event) => setDepth(Number(event.target.value))}
            />
          </label>

          <label className="lab-check">
            <input
              type="checkbox"
              checked={lively}
              onChange={(event) => setLively(event.target.checked)}
            />
            Eyes follow the pointer
          </label>
        </form>
      </div>

      <section className="lab-sizes" aria-label="Avatar sizes">
        <div className="lab-size-row">
          <span className="lab-size-label">Head crop</span>
          {SIZES.map((size) => (
            <figure key={size} className="lab-size">
              <FlatCuso
                size={size}
                crop
                variant={variant}
                lively={lively}
                label=""
              />
              <figcaption>{size}</figcaption>
            </figure>
          ))}
        </div>
        <div className="lab-size-row">
          <span className="lab-size-label">Bot</span>
          {SIZES.map((size) => (
            <figure key={size} className="lab-size">
              <BotAvatar size={size} label="" {...bot} />
              <figcaption>{size}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    </main>
  );
}
