"use client";

import { type RefObject, useEffect, useEffectEvent, useRef } from "react";

import { type MountHandle, mount, type OrbExpression } from "@/lib/aurora-orb";

export interface AuroraOrbEvent {
  expr: OrbExpression;
  nonce: number;
  ms?: number;
}

export interface UseAuroraOrbCanvasOptions {
  seed?: string;
  placeholder?: boolean;
  animate?: boolean;
  size: number;
  speed: number;
  expression: OrbExpression | null;
  event: AuroraOrbEvent | null;
}

/**
 * Mounts and drives a live AuroraOrb `<canvas>` handle, updating expression,
 * speed, and one-shot pulse events without remounting the animation loop.
 */
export function useAuroraOrbCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  {
    seed,
    placeholder = false,
    animate = true,
    size,
    speed,
    expression,
    event,
  }: UseAuroraOrbCanvasOptions,
): void {
  const handleRef = useRef<MountHandle | null>(null);
  const lastEventNonceRef = useRef(0);
  const readInitialState = useEffectEvent(() => ({ speed, expression }));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const initial = readInitialState();
    const handle = mount(
      canvas,
      placeholder
        ? {
            placeholder: true,
            animate,
            speed: initial.speed,
            size,
            expression: initial.expression,
          }
        : {
            seed,
            speed: initial.speed,
            size,
            expression: initial.expression,
          },
    );
    handleRef.current = handle;
    return () => {
      handle.stop();
      handleRef.current = null;
    };
  }, [canvasRef, placeholder, seed, size, animate]);

  useEffect(() => {
    handleRef.current?.setExpression(expression ?? null);
  }, [expression]);

  useEffect(() => {
    handleRef.current?.setSpeed(speed);
  }, [speed]);

  useEffect(() => {
    if (event && event.nonce !== lastEventNonceRef.current) {
      lastEventNonceRef.current = event.nonce;
      handleRef.current?.pulse(event.expr, event.ms);
    }
  }, [event]);
}
