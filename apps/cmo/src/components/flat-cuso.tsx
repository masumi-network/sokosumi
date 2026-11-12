"use client";

import { useEffect, useId, useRef } from "react";

/*
 * Flat Cuso, traced from the "Flat Cuso · system" board of the CMO.XYZ
 * onboarding canvas: one outline weight, two eyes, no mouth, black and
 * white only. Coordinates are the master figure's; the line is 22 units.
 */

export type FlatCusoPose = "point" | "wave" | "stand";
export type FlatCusoVariant = "line" | "solid";

const LINE = 22;
const BODY = "M145 62V548L245 458L298 590L400 552L345 418H492Z";
const EYES = [226, 290];
const EYE_Y = 320;
const FULL_VIEW = "30 40 640 730";
/** Tip and eyes only: the head crop is the avatar. */
const CROP = { x: 89, y: 135, size: 280 };

const RIGHT_ARM: Record<
  FlatCusoPose,
  { d: string; hand: [number, number]; extra?: string }
> = {
  point: {
    d: "M418 328C470 322 506 292 511 232",
    hand: [511, 210],
    extra: "M511 190V128",
  },
  wave: {
    d: "M418 328C480 330 560 300 600 250",
    hand: [604, 238],
    extra: "M628 196L640 178M648 222L668 214",
  },
  stand: { d: "M470 430C520 450 524 520 506 566", hand: [504, 582] },
};

interface FlatCusoProps {
  size: number;
  pose?: FlatCusoPose;
  variant?: FlatCusoVariant;
  /** Show only the head in a circle, the avatar crop. */
  crop?: boolean;
  /** Blink, and let the eyes follow the pointer. */
  lively?: boolean;
  /** Accessible name; "" marks the drawing decorative. */
  label?: string;
}

export function FlatCuso({
  size,
  pose = "point",
  variant = "line",
  crop = false,
  lively = false,
  label = "Cuso",
}: FlatCusoProps) {
  const clipId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  // Small crops get a thicker line, never a thinner one.
  const line = crop ? Math.max(LINE, (CROP.size * 2.2) / size) : LINE;
  const arm = RIGHT_ARM[pose];

  useEffect(() => {
    const svg = svgRef.current;
    if (!lively || !svg) return;
    function look(event: PointerEvent) {
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const dx = (event.clientX - (rect.left + rect.width / 2)) / innerWidth;
      const dy = (event.clientY - (rect.top + rect.height / 2)) / innerHeight;
      const clamp = (value: number) => Math.max(-1, Math.min(1, value * 2));
      svg.style.setProperty("--gaze-x", `${clamp(dx) * 9}px`);
      svg.style.setProperty("--gaze-y", `${clamp(dy) * 7}px`);
    }
    window.addEventListener("pointermove", look);
    return () => window.removeEventListener("pointermove", look);
  }, [lively]);

  const figure = (
    <g
      className="flat-cuso-figure"
      strokeWidth={line}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        className="flat-cuso-limb"
        d="M140 362C78 362 52 430 90 478"
        fill="none"
      />
      <circle className="flat-cuso-hand" cx={97} cy={494} r={26} />
      <path
        className="flat-cuso-limb"
        data-part="arm-right"
        d={arm.d}
        fill="none"
      />
      <circle
        className="flat-cuso-hand"
        cx={arm.hand[0]}
        cy={arm.hand[1]}
        r={26}
      />
      {arm.extra && (
        <path className="flat-cuso-limb" d={arm.extra} fill="none" />
      )}
      <path className="flat-cuso-limb" d="M322 585L305 690M375 565L410 680" />
      <rect
        className="flat-cuso-shoe"
        x={240}
        y={682}
        width={110}
        height={62}
        rx={31}
        strokeWidth={LINE * 0.7}
      />
      <rect
        className="flat-cuso-shoe"
        x={364}
        y={670}
        width={116}
        height={62}
        rx={31}
        strokeWidth={LINE * 0.7}
      />
      <path
        className="flat-cuso-limb"
        d="M284 696V720M303 696V720M412 684V708M432 684V708"
        strokeWidth={LINE * 0.45}
      />
      <path
        className="flat-cuso-body"
        data-part="body"
        d={BODY}
        strokeWidth={line}
      />
      <g className="flat-cuso-eyes" data-lively={lively || undefined}>
        {EYES.map((cx) => (
          <ellipse key={cx} cx={cx} cy={EYE_Y} rx={17} ry={32} />
        ))}
      </g>
    </g>
  );

  const a11y =
    label === ""
      ? { "aria-hidden": true as const }
      : { role: "img", "aria-label": label };

  return (
    <svg
      ref={svgRef}
      className="flat-cuso"
      data-variant={variant}
      width={size}
      height={size}
      viewBox={
        crop ? `${CROP.x} ${CROP.y} ${CROP.size} ${CROP.size}` : FULL_VIEW
      }
      {...a11y}
    >
      {crop ? (
        <>
          <clipPath id={clipId}>
            <circle
              cx={CROP.x + CROP.size / 2}
              cy={CROP.y + CROP.size / 2}
              r={CROP.size / 2}
            />
          </clipPath>
          <g clipPath={`url(#${clipId})`}>
            <rect
              className="flat-cuso-stage"
              x={CROP.x}
              y={CROP.y}
              width={CROP.size}
              height={CROP.size}
            />
            {figure}
          </g>
          <circle
            className="flat-cuso-ring"
            cx={CROP.x + CROP.size / 2}
            cy={CROP.y + CROP.size / 2}
            r={CROP.size / 2 - line / 2}
            fill="none"
            strokeWidth={line * 0.6}
          />
        </>
      ) : (
        figure
      )}
    </svg>
  );
}
