import "fake-indexeddb/auto";

import { htmlPlugin } from "@m2d/html";
import { imagePlugin } from "@m2d/image";
import { listPlugin } from "@m2d/list";
import { mathPlugin } from "@m2d/math";
import { tablePlugin } from "@m2d/table";
import { sanitizeFileName } from "@sokosumi/utils";
import type { IImageOptions } from "docx";
import {
  AlignmentType,
  Footer,
  Header,
  ImageRun,
  PageNumber,
  Paragraph,
  TextRun,
} from "docx";
import { type EmptyNode, type IPlugin, toDocx } from "mdast2docx";
import { type NextRequest, NextResponse } from "next/server";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { getSession } from "@/lib/auth/auth.server";
import {
  MAX_MARKDOWN_BYTES,
  withDocxExportFetchGuard,
} from "@/lib/utils/docx-export-ssrf";
import { setupDomContext } from "@/lib/utils/dom-context";
import { hasHtmlContent } from "@/lib/utils/html-detection";
import { readRequestJsonWithByteLimit } from "@/lib/utils/read-request-json-limited";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GenerateDocxRequest {
  markdown?: string;
  fileName?: string;
  logoPng?: string;
  kanjiLogoPng?: string;
}

const docTitle = "Sokosumi Export";
const docAuthor = "Sokosumi";
const appAuthorUrl = "https://sokosumi.com";

const defaultFont = "Arial";

const defaultStyles = {
  default: {
    document: {
      run: { font: defaultFont },
    },
    heading1: {
      run: { font: defaultFont, bold: true },
    },
    heading2: {
      run: { font: defaultFont, bold: true },
    },
    heading3: {
      run: { font: defaultFont, bold: true },
    },
    heading4: {
      run: { font: defaultFont, bold: true },
    },
    heading5: {
      run: { font: defaultFont, bold: true },
    },
    heading6: {
      run: { font: defaultFont, bold: true },
    },
    listParagraph: {
      run: { font: defaultFont },
    },
    listItem: {
      run: { font: defaultFont },
    },
    listNumber: {
      run: { font: defaultFont },
    },
  },
  titleStyles: [
    { id: "Title", name: "Title", run: { font: defaultFont, bold: true } },
  ],
  tableStyles: [{ id: "Table", name: "Table", run: { font: defaultFont } }],
  paragraphStyles: [
    { id: "Normal", name: "Normal", run: { font: defaultFont } },
  ],
};

function dataUrlToBuffer(dataUrl: string | undefined) {
  if (!dataUrl || !dataUrl.startsWith("data:")) return undefined;
  const [_, base64] = dataUrl.split(",");
  if (!base64) return undefined;
  return Buffer.from(base64, "base64");
}

function createHeaderElements(
  logoBuffer: Buffer | undefined,
  kanjiLogoBuffer: Buffer | undefined,
): Paragraph[] {
  const headerChildren: (ImageRun | TextRun)[] = [];
  if (logoBuffer) {
    headerChildren.push(
      new ImageRun({
        data: logoBuffer,
        transformation: { width: 120, height: 20 },
      } as unknown as IImageOptions),
    );
  }
  if (logoBuffer && kanjiLogoBuffer) {
    headerChildren.push(new TextRun({ text: "   " }));
  }
  if (kanjiLogoBuffer) {
    headerChildren.push(
      new ImageRun({
        data: kanjiLogoBuffer,
        transformation: { width: 20, height: 40 },
      } as unknown as IImageOptions),
    );
  }
  if (headerChildren.length > 0) {
    return [new Paragraph({ children: headerChildren })];
  }
  return [
    new Paragraph({
      children: [
        new TextRun({ text: docAuthor, bold: true, font: defaultFont }),
      ],
    }),
  ];
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await readRequestJsonWithByteLimit<GenerateDocxRequest>(
    request,
    MAX_MARKDOWN_BYTES,
  );
  if (!parsed.ok) {
    if (parsed.error === "too_large") {
      return NextResponse.json(
        { error: "Markdown payload too large" },
        { status: 413 },
      );
    }
    if (parsed.error === "invalid_json") {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    return NextResponse.json({ error: "Missing 'markdown'" }, { status: 400 });
  }

  const markdown = (parsed.value.markdown ?? "").toString();
  if (!markdown) {
    return NextResponse.json({ error: "Missing 'markdown'" }, { status: 400 });
  }

  if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES) {
    return NextResponse.json(
      { error: "Markdown payload too large" },
      { status: 413 },
    );
  }

  // Set up DOM context for server-side HTML processing (inject if needed)
  const cleanup = await setupDomContext();

  try {
    // Check if markdown contains HTML content
    const hasHtml = hasHtmlContent(markdown);
    const logoBuffer = dataUrlToBuffer(parsed.value.logoPng);
    const kanjiLogoBuffer = dataUrlToBuffer(parsed.value.kanjiLogoPng);
    const mdast = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkFrontmatter)
      .use(remarkMath)
      .parse(markdown);

    const headerElements: Paragraph[] = [];
    headerElements.push(...createHeaderElements(logoBuffer, kanjiLogoBuffer));

    const footerLeft = new Paragraph({
      alignment: AlignmentType.LEFT,
      children: [
        new TextRun({
          text: appAuthorUrl,
          bold: true,
          font: defaultFont,
        }),
      ],
    });
    const footerRight = new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [new TextRun({ children: [PageNumber.CURRENT] })],
    });

    // @m2d/image uses global fetch for remote markdown images — wrap so
    // private/link-local/metadata targets are blocked at connect time.
    const blob = await withDocxExportFetchGuard(() =>
      toDocx(
        mdast,
        {
          title: docTitle,
          author: docAuthor,
          styles: defaultStyles,
        } as unknown as Record<string, unknown>,
        {
          plugins: [
            tablePlugin(),
            imagePlugin(),
            listPlugin(),
            mathPlugin(),
            ...(hasHtml ? [htmlPlugin()] : []),
          ] as IPlugin<EmptyNode>[],
          headers: { default: new Header({ children: headerElements }) },
          footers: {
            default: new Footer({ children: [footerLeft, footerRight] }),
          },
        },
      ),
    );

    const fileName =
      sanitizeFileName(parsed.value.fileName ?? "output") + ".docx";
    const body =
      blob instanceof Blob
        ? blob
        : new Blob(
            [
              ((blob as Uint8Array).buffer as ArrayBuffer).slice(
                (blob as Uint8Array).byteOffset,
                (blob as Uint8Array).byteOffset +
                  (blob as Uint8Array).byteLength,
              ),
            ],
            {
              type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            },
          );

    return new Response(body, {
      status: 200,
      headers: {
        "content-type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": `attachment; filename="${fileName}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("DOCX generation error", error);
    return NextResponse.json(
      { error: "Failed to generate DOCX" },
      { status: 500 },
    );
  } finally {
    // Clean up DOM context
    cleanup();
  }
}
