import { describe, expect, it } from "vitest";

import { getDistinctProviderError } from "./studio-failure-notice";

const REASON = "The image provider could not finish this image.";

describe("getDistinctProviderError", () => {
  it.each([
    REASON,
    "  The image provider could not finish this image.  ",
    "THE IMAGE PROVIDER COULD NOT FINISH THIS IMAGE.",
    "The\timage  provider\ncould not finish this image.",
    "The image provider could not finish this image",
    "The image provider could not finish this image . ! ? ",
    "  THE\tIMAGE  PROVIDER\nCOULD NOT FINISH THIS IMAGE…！？  ",
  ])("hides a repeated reason: %s", (error) => {
    expect(getDistinctProviderError(REASON, error)).toBeNull();
  });

  it.each([null, "", " \t\n "])("hides missing provider text: %s", (error) => {
    expect(getDistinctProviderError(REASON, error)).toBeNull();
  });

  it.each([
    "Unexpected status code: 422",
    "  The image provider could not finish this image: timeout.  ",
    "The image provider could not finish, this image.",
  ])("preserves distinct provider text verbatim: %s", (error) => {
    expect(getDistinctProviderError(REASON, error)).toBe(error);
  });

  it("normalizes the reason as well as the provider text", () => {
    expect(
      getDistinctProviderError(
        " \tTHE IMAGE\nPROVIDER COULD NOT FINISH THIS IMAGE! ",
        REASON,
      ),
    ).toBeNull();
  });
});
