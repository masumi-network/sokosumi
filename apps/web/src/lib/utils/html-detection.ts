export function hasHtmlContent(markdown: string): boolean {
  if (!markdown.includes("<")) {
    return false;
  }

  const htmlTagPattern =
    /<(p|div|span|table|img|a|h[1-6]|ul|ol|li|strong|em|br|hr|blockquote|article|section|nav|aside|header|footer|main|figure|figcaption|form|input|button|select|textarea|label|video|audio|canvas|svg)[>\s]/i;

  return htmlTagPattern.test(markdown);
}
