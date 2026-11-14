"use client";

import { useRef } from "react";

import { useMountEffect } from "@/hooks/use-mount-effect";
import { cn } from "@/lib/utils";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const FOIL_COLOR_TOKENS = [
  "--foil-1",
  "--foil-2",
  "--foil-3",
  "--foil-4",
];

const VERTEX_SHADER = `attribute vec2 p;void main(){gl_Position=vec4(p,0,1);}`;

// Domain-warped noise coloured by a loop through the four foil tokens, with
// thin bright creases and film grain.
const FRAGMENT_SHADER = `precision highp float;
uniform vec2 res; uniform float t; uniform float shine;
uniform vec3 c0,c1,c2,c3;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
vec3 pal(float x){x=fract(x)*4.;
  vec3 a=x<1.?c0:x<2.?c1:x<3.?c2:c3; vec3 b=x<1.?c1:x<2.?c2:x<3.?c3:c0;
  return mix(a,b,smoothstep(0.,1.,fract(x)));}
void main(){
  vec2 uv=gl_FragCoord.xy/res; vec2 p=uv*vec2(res.x/res.y,1.)*1.4;
  vec2 q=vec2(fbm(p+t*.03),fbm(p+vec2(5.2,1.3)-t*.025));
  vec2 r=vec2(fbm(p+2.4*q+vec2(1.7,9.2)),fbm(p+2.4*q+vec2(8.3,2.8)));
  float phase=fbm(p+2.6*r)*2.2+r.x*.8+t*.015;
  vec3 c=pal(phase);
  c+=pow(1.-abs(fract(phase*2.)-.5)*2.,10.)*.4*shine;
  c+=(h(gl_FragCoord.xy+fract(t))-.5)*.04;
  gl_FragColor=vec4(c,1.);
}`;

/**
 * The Home page's holographic foil: a slow WebGL drift in the `--foil-*`
 * tokens. It fades out toward the bottom, draws one still frame under reduced
 * motion, stops while off screen, and renders nothing where WebGL is missing.
 */
export function FoilBackground({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useMountEffect(() => {
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

    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY).matches;
    const start = performance.now();
    let frame = 0;
    let visible = true;
    let colorsStale = true;

    const applyColors = () => {
      const style = getComputedStyle(canvas);
      FOIL_COLOR_TOKENS.forEach((token, index) => {
        const [r, g, b] = cssColorToRgb(style.getPropertyValue(token));
        gl.uniform3f(uniform(`c${index}`), r, g, b);
      });
      gl.uniform1f(
        uniform("shine"),
        Number.parseFloat(style.getPropertyValue("--foil-shine")) || 0,
      );
      colorsStale = false;
    };

    const draw = () => {
      const ratio = Math.min(2, window.devicePixelRatio);
      const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
      }
      if (colorsStale) applyColors();
      gl.uniform2f(uniform("res"), width, height);
      gl.uniform1f(
        uniform("t"),
        reducedMotion ? 0 : (performance.now() - start) / 1000,
      );
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
  });

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn(
        "pointer-events-none mask-[linear-gradient(to_bottom,black_35%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_35%,transparent_100%)]",
        className,
      )}
    />
  );
}

/** Compiles and links a shader pair and puts it in use; null if it fails. */
export function linkProgram(
  gl: WebGLRenderingContext,
  vertexShader: string,
  fragmentShader: string,
): WebGLProgram | null {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertexShader],
    [gl.FRAGMENT_SHADER, fragmentShader],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  gl.useProgram(program);
  return program;
}

/** A `#rrggbb` token value as 0–1 channels; black when it is anything else. */
export function cssColorToRgb(value: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(
    value.trim(),
  );
  if (!match) return [0, 0, 0];
  return [match[1], match[2], match[3]].map(
    (channel) => Number.parseInt(channel ?? "0", 16) / 255,
  ) as [number, number, number];
}
