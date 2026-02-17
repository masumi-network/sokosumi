import { parseContentDispositionFilename } from "@/lib/utils/content-disposition";

describe("parseContentDispositionFilename", () => {
  it("returns plain filename value", () => {
    expect(
      parseContentDispositionFilename('attachment; filename="report.pdf"'),
    ).toBe("report.pdf");
  });

  it("returns decoded RFC5987 filename value", () => {
    expect(
      parseContentDispositionFilename(
        "attachment; filename*=UTF-8''%E2%82%AC%20rates.pdf",
      ),
    ).toBe("€ rates.pdf");
  });

  it("returns null when header is missing or invalid", () => {
    expect(parseContentDispositionFilename(null)).toBeNull();
    expect(parseContentDispositionFilename("inline")).toBeNull();
  });
});
