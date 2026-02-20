export interface NoticeTemplateHeader {
  title?: string;
  cover?: string;
  summary?: string;
  actionLabel?: string;
  actionUrl?: string;
}

export interface ParsedNoticeTemplate {
  header: NoticeTemplateHeader;
  bodyMarkdown: string;
}

const HEADER_KEY_MAP: Record<string, keyof NoticeTemplateHeader> = {
  title: "title",
  cover: "cover",
  summary: "summary",
  action_label: "actionLabel",
  action_url: "actionUrl",
};

function isDelimiterLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === "----" || trimmed === "---";
}

export function parseNoticeTemplate(markdown: string): ParsedNoticeTemplate {
  const normalizedMarkdown = markdown.replace(/\r\n/g, "\n");
  const lines = normalizedMarkdown.split("\n");

  if (lines.length === 0 || !isDelimiterLine(lines[0] ?? "")) {
    return {
      header: {},
      bodyMarkdown: normalizedMarkdown,
    };
  }

  const closingDelimiterIndex = lines.findIndex((line, index) => {
    return index > 0 && isDelimiterLine(line);
  });

  if (closingDelimiterIndex === -1) {
    return {
      header: {},
      bodyMarkdown: normalizedMarkdown,
    };
  }

  const header: NoticeTemplateHeader = {};
  for (const line of lines.slice(1, closingDelimiterIndex)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const mappedKey = HEADER_KEY_MAP[key];
    if (!mappedKey) {
      continue;
    }

    const value = line.slice(separatorIndex + 1).trim();
    if (value.length > 0) {
      header[mappedKey] = value;
    }
  }

  const bodyMarkdown = lines
    .slice(closingDelimiterIndex + 1)
    .join("\n")
    .replace(/^\n+/, "");

  return {
    header,
    bodyMarkdown,
  };
}
