import {
  applyGradientTokens,
  GRADIENT_GLSL,
  gradientLoopAt,
  gradientUnit,
  linkProgram,
} from "@/components/gradient-background";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const COVER_MS = 650;
const REVEAL_MS = 750;

// A wavy band of the Home gradient, with a soft light along its middle. `p`
// moves its centre across the screen (0 off the left, 0.5 the middle, 1 off
// the right); near the middle it widens until it covers everything, so the
// page can change unseen.
const FRAGMENT_SHADER = `precision highp float;
uniform vec2 res; uniform float unit; uniform float t; uniform float p;
${GRADIENT_GLSL}
void main(){
  vec2 uv=gl_FragCoord.xy/res; uv.y=1.-uv.y;
  float cover=max(0.,1.-abs(p-.5)/.16); cover*=cover;
  float x=uv.x+sin(uv.y*5.+t*3.)*.035+(n(vec2(uv.y*3.,t*.8))-.5)*.12;
  float d=(x-mix(-.55,1.55,p))/(.24+cover*.9);
  float a=clamp(exp(-d*d)*1.25+cover*.25,0.,1.);
  vec3 c=gradient(gl_FragCoord.xy/unit)+pow(max(0.,1.-abs(d)*1.8),6.)*.18;
  c+=grain(gl_FragCoord.xy)*.035;
  gl_FragColor=vec4(c*a,a);
}`;

let sweeping = false;

/**
 * Sweeps a gradient band over the screen around a change of workspace: it covers
 * the page, holds while `change` runs (a switch is a server round trip, so it
 * can take a second), then reveals the new workspace. Only for a switch
 * someone asked for: the workspace menu and finishing the Create workspace
 * wizard. Under reduced motion, without WebGL, or while a sweep already runs,
 * `change` just runs. The promise carries `change`'s own result.
 */
export async function sweepWorkspace(
  change: () => Promise<void>,
): Promise<void> {
  if (sweeping || window.matchMedia(REDUCED_MOTION_QUERY).matches) {
    return change();
  }
  const band = createBand();
  if (!band) return change();

  sweeping = true;
  try {
    await band.moveTo(0.5, COVER_MS);
    await change();
  } finally {
    await band.moveTo(1, REVEAL_MS);
    band.remove();
    sweeping = false;
  }
}

function createBand() {
  const canvas = document.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  // Above the `z-50` dialog the wizard closes under it.
  canvas.className = "pointer-events-none fixed inset-0 z-[70] size-full";
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true });
  const program =
    gl &&
    linkProgram(
      gl,
      "attribute vec2 a;void main(){gl_Position=vec4(a,0,1);}",
      FRAGMENT_SHADER,
    );
  if (!gl || !program) return null;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const ratio = Math.min(2, window.devicePixelRatio);
  canvas.width = Math.round(window.innerWidth * ratio);
  canvas.height = Math.round(window.innerHeight * ratio);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, "a");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  applyGradientTokens(gl, program, getComputedStyle(document.documentElement));
  gl.uniform2f(uniform("res"), canvas.width, canvas.height);
  gl.uniform1f(uniform("unit"), gradientUnit(ratio));
  document.body.append(canvas);

  const start = performance.now();
  let move = { from: 0, to: 0, at: start, ms: 1 };
  const progress = (now: number) => {
    const k = Math.min(1, (now - move.at) / move.ms);
    const eased = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
    return move.from + (move.to - move.from) * eased;
  };
  let frame = 0;
  const draw = (now: number) => {
    gl.uniform1f(uniform("t"), (now - start) / 1000);
    gl.uniform1f(uniform("p"), progress(now));
    gl.uniform1f(uniform("loop"), gradientLoopAt(false));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);

  return {
    /** Resolves on a timer, so a hidden tab, with no frames, still moves on. */
    moveTo(to: number, ms: number) {
      const now = performance.now();
      move = { from: progress(now), to, at: now, ms };
      return new Promise<void>((resolve) => setTimeout(resolve, ms));
    },
    remove() {
      cancelAnimationFrame(frame);
      canvas.remove();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
