import type { AvatarState } from "@sokosumi/soko-bot";
import type { AvatarModel } from "./model";
import { type Look, pose } from "./rig";

// Every pixel follows its view ray into the height field and takes the colour of the surface it
// hits (72 steps, 7 bisections), so there are no slice edges to show while the head turns. The
// eyes are sampled from their own texture, which is what lets them look around and blink.
const VS =
  "attribute vec2 a;varying vec2 v;void main(){v=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}";
const FS = `precision highp float;
varying vec2 v;
uniform sampler2D face, eyes, height;
uniform vec3 bg, cx, cy, cz;
uniform vec2 f0, pivot, gaze;
uniform float fs, rz, roll, squash, lift, open, edge;
uniform vec4 eyeL, eyeR;
float H(vec2 p) { return texture2D(height, p).r * rz; }
vec3 at(vec2 d, float t) { vec3 q = vec3(d, t); return vec3(pivot + vec2(dot(cx, q), dot(cy, q)), dot(cz, q)); }
bool inside(vec3 o) { float h = H(o.xy); return h > 0. && abs(o.z) <= h + edge; }
vec4 eye(vec2 q, vec4 e) {
  if (e.w < .5) return vec4(0.);
  vec2 rel = q - e.xy - gaze;
  rel.y /= open;
  if (length(rel) > e.z) return vec4(0.);
  return texture2D(eyes, e.xy + rel);
}
void main() {
  vec2 s = f0 + v * fs;
  s.y -= lift;
  float base = f0.y + fs;
  s.y = (s.y - base) / squash + base;
  vec2 d = s - pivot;
  float c = cos(-roll), sn = sin(-roll);
  d = vec2(c * d.x - sn * d.y, sn * d.x + c * d.y);
  float T = rz * 1.6, dt = 2. * T / 72.;
  float prev = T;
  vec3 col = bg;
  for (int i = 0; i <= 72; i++) {
    float t = T - float(i) * dt;
    if (inside(at(d, t))) {
      float a = prev, b = t;
      for (int k = 0; k < 7; k++) { float m = (a + b) * .5; if (inside(at(d, m))) b = m; else a = m; }
      vec2 q = at(d, b).xy;
      vec4 f = texture2D(face, q);
      col = f.rgb;
      vec4 e = eye(q, eyeL); col = mix(col, e.rgb, e.a);
      e = eye(q, eyeR); col = mix(col, e.rgb, e.a);
      break;
    }
    prev = t;
  }
  gl_FragColor = vec4(col, 1.);
}`;

interface Shared {
  gl: WebGLRenderingContext;
  canvas: HTMLCanvasElement;
  u: (name: string) => WebGLUniformLocation | null;
}

export interface LiveAvatar {
  setModel(model: AvatarModel): void;
  setState(state: AvatarState): void;
  /** Pointer position relative to the avatar, -1..1 per axis; null for none. */
  setLook(look: Look | null): void;
  /** Off screen avatars are not drawn, and with none visible the loop stops. */
  setVisible(visible: boolean): void;
  destroy(): void;
}

interface Impl {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  seed: number;
  state: AvatarState;
  look: Look | null;
  visible: boolean;
  model: AvatarModel | null;
  textures: WebGLTexture[];
  onFail: () => void;
}

/** One WebGL context for every avatar on the page; undefined until first asked, null if unavailable. */
let shared: Shared | null | undefined;
const all = new Set<Impl>();
let raf = 0;
let listening = false;

function getShared(): Shared | null {
  if (shared !== undefined) return shared;
  shared = null;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl", { antialias: false });
    if (!gl) return null;
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type);
      if (!s) throw new Error("no shader");
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(prog, name);
    ["face", "eyes", "height"].forEach((name, unit) => {
      gl.uniform1i(u(name), unit);
    });
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      shared = null;
      for (const av of [...all]) av.onFail();
    });
    shared = { gl, canvas, u };
  } catch {
    shared = null;
  }
  return shared;
}

const reducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

function upload(gl: WebGLRenderingContext, m: AvatarModel): WebGLTexture[] {
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  return [0, 1, 2].map((unit) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    for (const [p, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ] as const)
      gl.texParameteri(gl.TEXTURE_2D, p, v);
    if (unit === 2)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.LUMINANCE,
        m.size,
        m.size,
        0,
        gl.LUMINANCE,
        gl.UNSIGNED_BYTE,
        m.height,
      );
    else
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        unit === 0 ? m.face : m.eyes,
      );
    return t as WebGLTexture;
  });
}

function draw(av: Impl, t: number, look: Look | null) {
  const s = getShared();
  const m = av.model;
  if (!s || !m) return;
  const { gl, canvas, u } = s;
  const { width, height } = av.canvas;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  gl.viewport(0, 0, width, height);
  av.textures.forEach((tex, unit) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  });
  gl.uniform3fv(u("bg"), m.bg);
  gl.uniform2fv(u("f0"), [m.f0, m.f0]);
  gl.uniform1f(u("fs"), m.fs);
  gl.uniform2fv(u("pivot"), m.pivot);
  gl.uniform1f(u("rz"), m.rz);
  gl.uniform1f(u("edge"), 0.6 / m.size);
  const e = (i: number) => {
    const x = m.eyeList[i];
    return x ? [x.c[0], x.c[1], x.r, 1] : [0, 0, 0, 0];
  };
  gl.uniform4fv(u("eyeL"), e(0));
  gl.uniform4fv(u("eyeR"), e(1));
  const p = pose(av.seed, t, av.state, look);
  const cY = Math.cos(p.yaw);
  const sY = Math.sin(p.yaw);
  const cP = Math.cos(p.pitch);
  const sP = Math.sin(p.pitch);
  // Rows of the object→view rotation (yaw, then pitch); object = transpose × view.
  const r0 = [cY, 0, sY];
  const r1 = [sY * sP, cP, -cY * sP];
  const r2 = [-sY * cP, sP, cY * cP];
  gl.uniform3fv(u("cx"), [r0[0], r1[0], r2[0]] as number[]);
  gl.uniform3fv(u("cy"), [r0[1], r1[1], r2[1]] as number[]);
  gl.uniform3fv(u("cz"), [r0[2], r1[2], r2[2]] as number[]);
  gl.uniform1f(u("roll"), (p.roll * Math.PI) / 180);
  gl.uniform1f(u("squash"), p.sy);
  gl.uniform1f(u("lift"), p.lift * m.fs);
  gl.uniform2fv(u("gaze"), [p.gx * 0.018 * m.fs, p.gy * 0.012 * m.fs]);
  gl.uniform1f(u("open"), Math.max(0.08, 1 - Math.max(p.blink, p.squint)));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  // Same task as the draw, so the drawing buffer is still intact.
  av.ctx.drawImage(canvas, 0, 0);
}

function frame(now: number) {
  raf = 0;
  for (const av of all) if (av.visible) draw(av, now / 1000, av.look);
  schedule();
}

/** Runs the loop only while an avatar is on screen, the tab is visible and motion is allowed. */
function schedule() {
  if (raf || reducedMotion() || document.visibilityState !== "visible") return;
  for (const av of all)
    if (av.visible && av.model) {
      raf = requestAnimationFrame(frame);
      return;
    }
}

/** With reduced motion nothing animates: the rest pose is drawn once per change. */
function still(av: Impl) {
  if (reducedMotion() && av.visible && av.model) draw(av, 0, null);
}

export function createLiveAvatar(
  canvas: HTMLCanvasElement,
  {
    seed,
    state,
    onFail,
  }: { seed: number; state: AvatarState; onFail: () => void },
): LiveAvatar | null {
  const ctx = canvas.getContext("2d");
  if (!ctx || !getShared()) return null;
  if (!listening) {
    listening = true;
    document.addEventListener("visibilitychange", schedule);
  }
  const av: Impl = {
    canvas,
    ctx,
    seed,
    state,
    look: null,
    visible: false,
    model: null,
    textures: [],
    onFail,
  };
  all.add(av);
  const release = () => {
    const s = shared;
    if (s) for (const t of av.textures) s.gl.deleteTexture(t);
    av.textures = [];
  };
  return {
    setModel(model) {
      const s = getShared();
      if (!s) return av.onFail();
      release();
      av.model = model;
      av.textures = upload(s.gl, model);
      still(av);
      schedule();
    },
    setState(next) {
      av.state = next;
      still(av);
    },
    setLook(look) {
      av.look = look;
    },
    setVisible(visible) {
      av.visible = visible;
      still(av);
      schedule();
    },
    destroy() {
      all.delete(av);
      release();
    },
  };
}
