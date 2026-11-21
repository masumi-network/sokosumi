"use client";

import { useRef } from "react";

import { useGradientBackgroundCanvas } from "@/hooks/effects/use-gradient-background-canvas";
import { cn } from "@/lib/utils";

/**
 * The Home page's gradient: a slow WebGL drift in the `--gradient-*` tokens
 * that loops every four minutes. It fades out toward the bottom, draws one
 * still frame under reduced motion, stops while off screen, and renders
 * nothing where WebGL is missing.
 */
export function GradientBackground({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useGradientBackgroundCanvas(canvasRef);

  return (
    // A canvas ignores left and right insets and keeps its own 2:1 shape, so
    // the box that is placed is a div and the canvas fills it.
    <div
      aria-hidden
      className={cn(
        "pointer-events-none mask-[linear-gradient(to_bottom,black_35%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_35%,transparent_100%)]",
        className,
      )}
    >
      <canvas ref={canvasRef} className="block size-full" />
    </div>
  );
}
