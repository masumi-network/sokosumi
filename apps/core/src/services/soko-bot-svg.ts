/**
 * Why an SVG the bot wrote may not be stored, or null when it is plain
 * markup: no scripts, event handlers, embedded HTML or outside resources.
 */
export function unsafeSvgReason(content: string): string | null {
  const xmlPrefix = "<?xml";
  const commentStart = "<!--";
  const commentEnd = "-->";
  const svgPrefix = "<svg";
  const missingRoot = "An SVG must start with an <svg> element";
  let offset = 0;
  const skipWhitespace = () => {
    while (/\s/.test(content.charAt(offset))) offset += 1;
  };
  skipWhitespace();
  if (
    content.slice(offset, offset + xmlPrefix.length).toLowerCase() === xmlPrefix
  ) {
    const end = content.indexOf(">", offset + xmlPrefix.length);
    if (end === -1) return missingRoot;
    offset = end + ">".length;
    skipWhitespace();
  }
  // Consume each comment once. Retrying alternative comment boundaries permits
  // exponential backtracking when an invalid prefix never reaches an SVG root.
  while (content.startsWith(commentStart, offset)) {
    const end = content.indexOf(commentEnd, offset + commentStart.length);
    if (end === -1) return missingRoot;
    offset = end + commentEnd.length;
    skipWhitespace();
  }
  if (
    content.slice(offset, offset + svgPrefix.length).toLowerCase() !==
      svgPrefix ||
    !/[\s>]/.test(content.charAt(offset + svgPrefix.length))
  )
    return missingRoot;
  if (/<\s*(script|foreignObject|iframe|object|embed)\b/i.test(content))
    return "An SVG may not contain scripts or embedded HTML";
  if (/\son[a-z]+\s*=/i.test(content))
    return "An SVG may not contain event handlers";
  if (/(href|src)\s*=\s*(?:["']\s*)?(javascript:|https?:|\/\/)/i.test(content))
    return "An SVG may not link outside resources; draw everything inline";
  if (/url\(\s*(?:["']\s*)?(javascript:|https?:|\/\/)/i.test(content))
    return "An SVG may not load outside resources; draw everything inline";
  return null;
}
