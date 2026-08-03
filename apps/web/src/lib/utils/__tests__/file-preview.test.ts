import { describe, expect, it } from "vitest";

import {
  getDocumentPreviewKind,
  isOfficeFile,
  isOfficeMediaType,
  isPdfMediaType,
  isPdfUrl,
  isTextPreviewMediaType,
  isTextPreviewUrl,
  officeExtensionFromMediaType,
  officeViewerUrl,
  pdfEmbedUrl,
} from "@/lib/utils/file-preview";

describe("isOfficeFile", () => {
  it("recognizes docx/pptx/xlsx extensions", () => {
    expect(isOfficeFile("https://blob.example/report.docx")).toBe(true);
    expect(isOfficeFile("https://blob.example/deck.pptx")).toBe(true);
    expect(isOfficeFile("https://blob.example/sheet.xlsx")).toBe(true);
    expect(isOfficeFile("https://blob.example/legacy.doc")).toBe(true);
  });

  it("rejects non-office extensions", () => {
    expect(isOfficeFile("https://blob.example/notes.pdf")).toBe(false);
    expect(isOfficeFile("https://blob.example/archive.zip")).toBe(false);
    expect(isOfficeFile("https://blob.example/no-extension")).toBe(false);
  });
});

describe("isOfficeMediaType", () => {
  it("recognizes Office MIME types", () => {
    expect(
      isOfficeMediaType(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(true);
  });

  it("rejects other MIME types and missing values", () => {
    expect(isOfficeMediaType("application/pdf")).toBe(false);
    expect(isOfficeMediaType(null)).toBe(false);
    expect(isOfficeMediaType(undefined)).toBe(false);
  });
});

describe("officeExtensionFromMediaType", () => {
  it("maps a known MIME type to its extension", () => {
    expect(
      officeExtensionFromMediaType(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ).toBe("pptx");
  });

  it("returns undefined for unknown MIME types", () => {
    expect(officeExtensionFromMediaType("application/zip")).toBeUndefined();
    expect(officeExtensionFromMediaType(null)).toBeUndefined();
  });
});

describe("isPdfUrl / isPdfMediaType", () => {
  it("recognizes a .pdf extension", () => {
    expect(isPdfUrl("https://blob.example/report.pdf")).toBe(true);
    expect(isPdfUrl("https://blob.example/report.docx")).toBe(false);
  });

  it("recognizes the application/pdf MIME type", () => {
    expect(isPdfMediaType("application/pdf")).toBe(true);
    expect(isPdfMediaType("APPLICATION/PDF")).toBe(true);
    expect(isPdfMediaType("application/zip")).toBe(false);
  });
});

describe("isTextPreviewUrl / isTextPreviewMediaType", () => {
  it("recognizes txt/md extensions", () => {
    expect(isTextPreviewUrl("https://blob.example/notes.txt")).toBe(true);
    expect(isTextPreviewUrl("https://blob.example/readme.md")).toBe(true);
    expect(isTextPreviewUrl("https://blob.example/data.csv")).toBe(false);
  });

  it("recognizes text/plain and text/markdown MIME types", () => {
    expect(isTextPreviewMediaType("text/plain")).toBe(true);
    expect(isTextPreviewMediaType("text/markdown")).toBe(true);
    expect(isTextPreviewMediaType("text/csv")).toBe(false);
  });
});

describe("getDocumentPreviewKind", () => {
  it("returns 'office' for Office files by extension or MIME type", () => {
    expect(getDocumentPreviewKind("https://blob.example/report.docx")).toBe(
      "office",
    );
    expect(
      getDocumentPreviewKind(
        "https://blob.example/report",
        "application/vnd.ms-excel",
      ),
    ).toBe("office");
  });

  it("returns 'pdf' for PDF files", () => {
    expect(getDocumentPreviewKind("https://blob.example/report.pdf")).toBe(
      "pdf",
    );
  });

  it("returns 'text' for txt/markdown files", () => {
    expect(getDocumentPreviewKind("https://blob.example/notes.md")).toBe(
      "text",
    );
  });

  it("returns null for unsupported file types instead of a catch-all guess", () => {
    expect(getDocumentPreviewKind("https://blob.example/archive.zip")).toBe(
      null,
    );
    expect(getDocumentPreviewKind("https://blob.example/data.csv")).toBe(null);
    expect(getDocumentPreviewKind("https://blob.example/video.mp4")).toBe(null);
    expect(getDocumentPreviewKind("https://blob.example/unknown-binary")).toBe(
      null,
    );
  });
});

describe("officeViewerUrl", () => {
  it("passes an already-extensioned URL through unchanged", () => {
    const url = officeViewerUrl("https://blob.example/report.docx");
    expect(url).toBe(
      "https://view.officeapps.live.com/op/embed.aspx?src=https%3A%2F%2Fblob.example%2Freport.docx",
    );
  });

  it("appends a synthetic filename for extensionless URLs using the hint", () => {
    const url = officeViewerUrl("https://blob.example/report", "pptx");
    expect(url).toContain(
      encodeURIComponent("https://blob.example/report?filename=file.pptx"),
    );
  });

  it("defaults to docx when no hint is given for an extensionless URL", () => {
    const url = officeViewerUrl("https://blob.example/report");
    expect(url).toContain(
      encodeURIComponent("https://blob.example/report?filename=file.docx"),
    );
  });
});

describe("pdfEmbedUrl", () => {
  it("hides the browser's native PDF chrome", () => {
    expect(pdfEmbedUrl("https://blob.example/report.pdf")).toBe(
      "https://blob.example/report.pdf#toolbar=0&navpanes=0&scrollbar=0&view=FitH",
    );
  });
});
