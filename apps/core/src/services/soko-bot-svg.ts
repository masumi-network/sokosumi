/**
 * Why an SVG the bot wrote may not be stored, or null when it is plain
 * markup: no scripts, event handlers, embedded HTML or outside resources.
 */
export function unsafeSvgReason(content: string): string | null {
  if (!/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(content))
    return "An SVG must start with an <svg> element";
  if (/<\s*(script|foreignObject|iframe|object|embed)\b/i.test(content))
    return "An SVG may not contain scripts or embedded HTML";
  if (/\son[a-z]+\s*=/i.test(content))
    return "An SVG may not contain event handlers";
  if (/(href|src)\s*=\s*["']?\s*(javascript:|https?:|\/\/)/i.test(content))
    return "An SVG may not link outside resources; draw everything inline";
  if (/url\(\s*["']?\s*(javascript:|https?:|\/\/)/i.test(content))
    return "An SVG may not load outside resources; draw everything inline";
  return null;
}
