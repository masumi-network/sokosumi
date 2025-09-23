import "fake-indexeddb/auto";

import { htmlPlugin } from "@m2d/html";
import { imagePlugin } from "@m2d/image";
import { listPlugin } from "@m2d/list";
import { mathPlugin } from "@m2d/math";
import { tablePlugin } from "@m2d/table";
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
import { EmptyNode, IPlugin, toDocx } from "mdast2docx";
import { NextRequest, NextResponse } from "next/server";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { setupDomContext } from "@/lib/utils/dom-context";
import { sanitizeFileName } from "@/lib/utils/file";
import { hasHtmlContent } from "@/lib/utils/html-detection";

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
  const [_meta, base64] = dataUrl.split(",");
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
  // Set up DOM context for server-side HTML processing
  const cleanup = await setupDomContext();

  try {
    const json = (await request.json()) as GenerateDocxRequest;
    const markdown = (json.markdown ?? "").toString();
    if (!markdown) {
      return NextResponse.json(
        { error: "Missing 'markdown'" },
        { status: 400 },
      );
    }

    // Check if markdown contains HTML content
    const hasHtml = hasHtmlContent(markdown);
    const logoBuffer = dataUrlToBuffer(json.logoPng);
    const kanjiLogoBuffer = dataUrlToBuffer(json.kanjiLogoPng);
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
    const blob = await toDocx(
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
    );

    const fileName = sanitizeFileName(json.fileName ?? "output") + ".docx";
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
