import { describe, expect, it } from "vitest";

import {
  classifyFilePreview,
  getDocumentPreviewKind,
  isAudioMediaType,
  isAudioUrl,
  isOfficeFile,
  isOfficeMediaType,
  isPdfMediaType,
  isPdfUrl,
  isTextPreviewMediaType,
  isTextPreviewUrl,
  isVideoMediaType,
  isVideoUrl,
  officeExtensionFromMediaType,
  officeViewerUrl,
  pdfEmbedUrl,
  stripForcedDownloadParam,
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
    expect(isPdfMediaType("application/pdf; charset=binary")).toBe(true);
    expect(isPdfMediaType("application/zip")).toBe(false);
  });
});

describe("isTextPreviewUrl / isTextPreviewMediaType", () => {
  it("recognizes txt/md extensions", () => {
    expect(isTextPreviewUrl("https://blob.example/notes.txt")).toBe(true);
    expect(isTextPreviewUrl("https://blob.example/readme.md")).toBe(true);
    expect(isTextPreviewUrl("https://blob.example/data.csv")).toBe(false);
  });

  it("recognizes text MIME types including Content-Type parameters", () => {
    expect(isTextPreviewMediaType("text/plain")).toBe(true);
    expect(isTextPreviewMediaType("text/plain; charset=utf-8")).toBe(true);
    expect(isTextPreviewMediaType("text/markdown")).toBe(true);
    expect(isTextPreviewMediaType("text/csv")).toBe(false);
    expect(isTextPreviewMediaType("application/json")).toBe(false);
  });
});

describe("isVideoUrl / isVideoMediaType", () => {
  it("recognizes video extensions", () => {
    expect(isVideoUrl("https://blob.example/clip.mp4")).toBe(true);
    expect(isVideoUrl("https://blob.example/clip.webm")).toBe(true);
    expect(isVideoUrl("https://blob.example/clip.ogg")).toBe(true);
    expect(isVideoUrl("https://blob.example/clip.mov")).toBe(true);
    expect(isVideoUrl("https://blob.example/clip.m4v")).toBe(true);
    expect(isVideoUrl("https://blob.example/clip.mp3")).toBe(false);
  });

  it("recognizes video/* MIME types", () => {
    expect(isVideoMediaType("video/mp4")).toBe(true);
    expect(isVideoMediaType("VIDEO/WEBM; codecs=vp9")).toBe(true);
    expect(isVideoMediaType("audio/mp4")).toBe(false);
    expect(isVideoMediaType(null)).toBe(false);
  });
});

describe("isAudioUrl / isAudioMediaType", () => {
  it("recognizes audio extensions", () => {
    expect(isAudioUrl("https://blob.example/track.mp3")).toBe(true);
    expect(isAudioUrl("https://blob.example/track.wav")).toBe(true);
    expect(isAudioUrl("https://blob.example/track.m4a")).toBe(true);
    expect(isAudioUrl("https://blob.example/track.aac")).toBe(true);
    expect(isAudioUrl("https://blob.example/track.flac")).toBe(true);
    expect(isAudioUrl("https://blob.example/track.opus")).toBe(true);
    expect(isAudioUrl("https://blob.example/track.oga")).toBe(true);
    // .ogg is video-extension allowlist, not audio
    expect(isAudioUrl("https://blob.example/track.ogg")).toBe(false);
    expect(isAudioUrl("https://blob.example/clip.mp4")).toBe(false);
  });

  it("recognizes audio/* MIME types", () => {
    expect(isAudioMediaType("audio/mpeg")).toBe(true);
    expect(isAudioMediaType("audio/ogg")).toBe(true);
    expect(isAudioMediaType("audio/ogg; codecs=opus")).toBe(true);
    expect(isAudioMediaType("video/mp4")).toBe(false);
    expect(isAudioMediaType(null)).toBe(false);
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

describe("stripForcedDownloadParam", () => {
  it("removes download=1 / download=true while keeping other query params", () => {
    expect(
      stripForcedDownloadParam(
        "https://blob.example/report.pdf?download=1&token=abc",
      ),
    ).toBe("https://blob.example/report.pdf?token=abc");
    expect(
      stripForcedDownloadParam("https://blob.example/report.pdf?download=true"),
    ).toBe("https://blob.example/report.pdf");
  });

  it("leaves URLs without a download flag unchanged", () => {
    expect(stripForcedDownloadParam("https://blob.example/report.pdf")).toBe(
      "https://blob.example/report.pdf",
    );
  });

  it("returns the input unchanged when the URL cannot be parsed", () => {
    expect(stripForcedDownloadParam("/uploads/report.pdf?download=1")).toBe(
      "/uploads/report.pdf?download=1",
    );
  });
});

describe("pdfEmbedUrl", () => {
  it("hides the browser's native PDF chrome", () => {
    expect(pdfEmbedUrl("https://blob.example/report.pdf")).toBe(
      "https://blob.example/report.pdf#toolbar=0&navpanes=0&scrollbar=0&view=FitH",
    );
  });

  it("strips a forced-download query param before adding the hash", () => {
    expect(pdfEmbedUrl("https://blob.example/report.pdf?download=1")).toBe(
      "https://blob.example/report.pdf#toolbar=0&navpanes=0&scrollbar=0&view=FitH",
    );
  });
});

describe("classifyFilePreview", () => {
  it("classifies an image by URL extension", () => {
    expect(classifyFilePreview("https://blob.example/photo.png")).toEqual({
      isImage: true,
      isVideo: false,
      isAudio: false,
      documentKind: null,
    });
  });

  it("classifies an image by media type when the URL has no extension", () => {
    expect(
      classifyFilePreview("https://blob.example/photo", null, "image/png"),
    ).toEqual({
      isImage: true,
      isVideo: false,
      isAudio: false,
      documentKind: null,
    });
  });

  it("classifies a document when it isn't an image", () => {
    expect(classifyFilePreview("https://blob.example/report.pdf")).toEqual({
      isImage: false,
      isVideo: false,
      isAudio: false,
      documentKind: "pdf",
    });
  });

  it("falls back to the filename when the URL has no extension", () => {
    expect(
      classifyFilePreview("https://blob.example/report", "report.docx"),
    ).toEqual({
      isImage: false,
      isVideo: false,
      isAudio: false,
      documentKind: "office",
    });
  });

  it("classifies video by extension", () => {
    expect(classifyFilePreview("https://blob.example/clip.mp4")).toEqual({
      isImage: false,
      isVideo: true,
      isAudio: false,
      documentKind: null,
    });
  });

  it("classifies video by mediaType when URL has no extension", () => {
    expect(
      classifyFilePreview("https://blob.example/abcdef", null, "video/mp4"),
    ).toEqual({
      isImage: false,
      isVideo: true,
      isAudio: false,
      documentKind: null,
    });
  });

  it("classifies video via fileName fallback", () => {
    expect(
      classifyFilePreview("https://blob.example/abcdef", "movie.mp4"),
    ).toEqual({
      isImage: false,
      isVideo: true,
      isAudio: false,
      documentKind: null,
    });
  });

  it("classifies audio by extension", () => {
    expect(classifyFilePreview("https://blob.example/track.mp3")).toEqual({
      isImage: false,
      isVideo: false,
      isAudio: true,
      documentKind: null,
    });
  });

  it("classifies audio by mediaType (including audio/ogg)", () => {
    expect(
      classifyFilePreview("https://blob.example/abcdef", null, "audio/ogg"),
    ).toEqual({
      isImage: false,
      isVideo: false,
      isAudio: true,
      documentKind: null,
    });
  });

  it("treats extension-only .ogg as video", () => {
    expect(classifyFilePreview("https://blob.example/clip.ogg")).toEqual({
      isImage: false,
      isVideo: true,
      isAudio: false,
      documentKind: null,
    });
  });

  it("prefers image over video when both could match", () => {
    // image/* MIME wins even if filename looks like video (defensive)
    expect(
      classifyFilePreview("https://blob.example/file", "file.mp4", "image/png"),
    ).toEqual({
      isImage: true,
      isVideo: false,
      isAudio: false,
      documentKind: null,
    });
  });

  it("classifies unsupported file types as neither image, media, nor document", () => {
    expect(classifyFilePreview("https://blob.example/archive.zip")).toEqual({
      isImage: false,
      isVideo: false,
      isAudio: false,
      documentKind: null,
    });
  });
});
