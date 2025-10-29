/**
 * Detects if a markdown string contains HTML content that requires special processing.
 *
 * This function checks for common HTML tags to determine if the content
 * should be processed with HTML plugins during document export.
 *
 * @param markdown - The markdown content to check
 * @returns true if HTML content is detected, false otherwise
 */
export function hasHtmlContent(markdown: string): boolean {
  // Check if the string contains a '<' character first (quick check)
  if (!markdown.includes("<")) {
    return false;
  }

  // Check for common HTML tags including HTML5 semantic elements
  // This regex looks for opening tags of common HTML elements
  // The [>\s] part matches either '>' or whitespace after the tag name,
  // which handles both simple tags like <p> and tags with attributes like <p class="...">
  const htmlTagPattern =
    /<(p|div|span|table|img|a|h[1-6]|ul|ol|li|strong|em|br|hr|blockquote|article|section|nav|aside|header|footer|main|figure|figcaption|form|input|button|select|textarea|label|video|audio|canvas|svg)[>\s]/i;

  return htmlTagPattern.test(markdown);
}
