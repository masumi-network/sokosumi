"use client";

import { Check, Copy } from "lucide-react";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { type PointerEvent, useState } from "react";
import { toast } from "sonner";

import { BUZZ_COLORS, BuzzMark } from "@/components/buzz/buzz-brand";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const { yellow, ink } = BUZZ_COLORS;
/** Critically damped: the card follows the pointer and settles without bounce. */
const TILT_SPRING = { stiffness: 260, damping: 26, mass: 0.6 };
const MAX_TILT_DEGREES = 14;

export interface BuzzAgentCardProps {
  name: string;
  image: string | null;
  npub: string;
  /** Staggers the idle drift so a row of cards does not move in step. */
  index: number;
  personalLabel: string;
  copyLabel: string;
  copiedLabel: string;
}

/**
 * A Buzz agent as a Buzz-yellow card that tilts toward the pointer, with the
 * picture standing off the surface. Copying its key is the card's action.
 */
export function BuzzAgentCard({
  name,
  image,
  npub,
  index,
  personalLabel,
  copyLabel,
  copiedLabel,
}: BuzzAgentCardProps) {
  const reduceMotion = useReducedMotion();
  const [copied, setCopied] = useState(false);
  // Pointer position over the card, -0.5 … 0.5 on each axis.
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const rotateX = useSpring(
    useTransform(pointerY, (y) => -y * MAX_TILT_DEGREES),
    TILT_SPRING,
  );
  const rotateY = useSpring(
    useTransform(pointerX, (x) => x * MAX_TILT_DEGREES),
    TILT_SPRING,
  );

  const track = (event: PointerEvent<HTMLDivElement>) => {
    if (reduceMotion || event.pointerType === "touch") return;
    const box = event.currentTarget.getBoundingClientRect();
    pointerX.set((event.clientX - box.left) / box.width - 0.5);
    pointerY.set((event.clientY - box.top) / box.height - 0.5);
  };
  const release = () => {
    pointerX.set(0);
    pointerY.set(0);
  };
  const copyKey = async () => {
    await navigator.clipboard.writeText(npub);
    setCopied(true);
    toast.success(copiedLabel);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <motion.div
      className="perspective-distant"
      animate={
        reduceMotion
          ? undefined
          : { rotateY: [-4, 4, -4], rotateX: [2, -2, 2], y: [0, -4, 0] }
      }
      transition={{
        duration: 7 + index * 0.9,
        repeat: Number.POSITIVE_INFINITY,
        ease: "easeInOut",
      }}
      style={{ transformStyle: "preserve-3d" }}
    >
      <motion.div
        data-testid="buzz-agent-card"
        onPointerMove={track}
        onPointerLeave={release}
        className="relative flex aspect-[4/5] flex-col justify-between rounded-2xl p-4 shadow-sm transition-shadow hover:shadow-md"
        style={{
          rotateX,
          rotateY,
          transformStyle: "preserve-3d",
          backgroundColor: yellow,
          color: ink,
          backgroundImage: `radial-gradient(${ink}26 1px, transparent 1.2px)`,
          backgroundSize: "14px 14px",
        }}
      >
        <div
          className="relative flex items-center justify-between gap-2"
          style={{ transform: "translateZ(24px)" }}
        >
          <BuzzMark className="w-6" />
          <span
            className="rounded-full px-2 py-0.5 text-2xs font-semibold"
            style={{ backgroundColor: ink, color: yellow }}
          >
            {personalLabel}
          </span>
        </div>
        <div
          className="relative flex justify-center"
          style={{ transform: "translateZ(56px)" }}
        >
          <Avatar
            className="size-24 rounded-full border-4"
            style={{ borderColor: ink }}
          >
            {image ? <AvatarImage src={image} alt="" /> : null}
            <AvatarFallback
              className="text-2xl font-semibold"
              style={{ backgroundColor: ink, color: yellow }}
            >
              {name.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        </div>
        <div
          className="relative min-w-0 space-y-1 text-center"
          style={{ transform: "translateZ(32px)" }}
        >
          <p className="truncate text-base font-semibold">{name}</p>
          <button
            type="button"
            onClick={() => void copyKey()}
            aria-label={copyLabel}
            className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 font-mono text-xs transition-transform active:scale-95"
            style={{ backgroundColor: `${ink}14` }}
          >
            <span className="truncate">{`${npub.slice(0, 9)}…${npub.slice(-4)}`}</span>
            {copied ? (
              <Check className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <Copy className="size-3.5 shrink-0" aria-hidden />
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
