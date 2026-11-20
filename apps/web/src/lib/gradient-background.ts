const GRADIENT_COLOR_TOKENS = [
  "--gradient-1",
  "--gradient-2",
  "--gradient-3",
  "--gradient-4",
];

/** One turn of the gradient's drift; it loops back to where it started. */
const GRADIENT_LOOP_MS = 240_000;
/** CSS px per unit of the pattern, so every gradient shows the same size. */
const GRADIENT_UNIT_PX = 1200;

/**
 * The gradient as a GLSL function, shared by the Home background and the
 * workspace sweep: `gradient(p)` is its colour at point `p` (px / unit), big
 * soft blobs that loop through the four tokens, a little more saturated than
 * the tokens so they show on a white page. The drift circles once per `loop`
 * 0→1 and the colours shift one full turn, so the motion repeats with no seam.
 */
export const GRADIENT_GLSL = `
uniform vec3 c0,c1,c2,c3; uniform float loop;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
  return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
vec3 pal(float x){x=fract(x)*4.;
  vec3 a=x<1.?c0:x<2.?c1:x<3.?c2:c3; vec3 b=x<1.?c1:x<2.?c2:x<3.?c3:c0;
  return mix(a,b,smoothstep(0.,1.,fract(x)));}
vec3 gradient(vec2 p){
  float a=6.2831853*loop;
  vec2 drift=vec2(cos(a),sin(a));
  float w=n(p*5.+drift*.9)*.35+n(p*1.8-drift.yx*.5)*.3;
  vec3 c=pal(p.x*.9-p.y*.35+w+loop);
  return mix(vec3(dot(c,vec3(.333))),c,1.7);
}
float grain(vec2 px){return h(px+fract(loop*997.))-.5;}
`;

/**
 * Where the drift is now, on the wall clock rather than since mount, so a
 * remount (a revisit, a workspace switch) carries on from the same place.
 */
export function gradientLoopAt(reducedMotion: boolean): number {
  return reducedMotion ? 0 : (Date.now() % GRADIENT_LOOP_MS) / GRADIENT_LOOP_MS;
}

/** Sets the gradient's colours from the `--gradient-*` tokens. */
export function applyGradientTokens(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  style: CSSStyleDeclaration,
) {
  GRADIENT_COLOR_TOKENS.forEach((token, index) => {
    gl.uniform3f(
      gl.getUniformLocation(program, `c${index}`),
      ...cssColorToRgb(style.getPropertyValue(token)),
    );
  });
}

/** The `unit` uniform for a canvas drawn at `ratio` device px per CSS px. */
export function gradientUnit(ratio: number): number {
  return GRADIENT_UNIT_PX * ratio;
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
