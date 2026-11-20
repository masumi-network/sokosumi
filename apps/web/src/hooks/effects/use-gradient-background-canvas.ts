"use client";

import { type RefObject, useEffect } from "react";

import {
  matchesMediaQuery,
  REDUCED_MOTION_MEDIA_QUERY,
} from "@/hooks/effects/use-media-query";
import {
  applyGradientTokens,
  GRADIENT_GLSL,
  gradientLoopAt,
  gradientUnit,
  linkProgram,
} from "@/lib/gradient-background";

const VERTEX_SHADER = `attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}`;

const FRAGMENT_SHADER = `precision highp float;
uniform float unit;
${GRADIENT_GLSL}
void main(){
  vec3 c=gradient(gl_FragCoord.xy/unit)+grain(gl_FragCoord.xy)*.035;
  gl_FragColor=vec4(c,1.);
}`;

/**
 * Mounts the WebGL gradient background shader onto `canvasRef`, re-reading
 * `--gradient-*` tokens on theme changes, drawing a single responsive frame
 * under reduced motion, and pausing the rAF loop while off screen.
 */
export function useGradientBackgroundCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl");
    if (!canvas || !gl) return;
    const program = linkProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    if (!program) return;

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniform = (name: string) => gl.getUniformLocation(program, name);

    const reducedMotion = matchesMediaQuery(REDUCED_MOTION_MEDIA_QUERY);
    let frame = 0;
    let visible = true;
    let colorsStale = true;

    const draw = () => {
      const ratio = Math.min(2, window.devicePixelRatio);
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      if (colorsStale) {
        applyGradientTokens(gl, program, getComputedStyle(canvas));
        colorsStale = false;
      }
      gl.uniform1f(uniform("unit"), gradientUnit(ratio));
      gl.uniform1f(uniform("loop"), gradientLoopAt(reducedMotion));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    const loop = () => {
      draw();
      frame = visible ? requestAnimationFrame(loop) : 0;
    };

    // The theme switch swaps the tokens, so read them again on the next draw.
    const themeObserver = new MutationObserver(() => {
      colorsStale = true;
      if (reducedMotion) draw();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });

    if (reducedMotion) {
      draw();
      const resizeObserver = new ResizeObserver(draw);
      resizeObserver.observe(canvas);
      return () => {
        resizeObserver.disconnect();
        themeObserver.disconnect();
      };
    }

    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      if (visible && !frame) frame = requestAnimationFrame(loop);
    });
    visibilityObserver.observe(canvas);
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      visibilityObserver.disconnect();
      themeObserver.disconnect();
    };
  }, [canvasRef]);
}
