import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useDocumentLocaleLang } from "./use-document-locale-lang";

describe("useDocumentLocaleLang", () => {
  const initialLang = document.documentElement.lang;

  afterEach(() => {
    document.documentElement.lang = initialLang;
  });

  it("sets documentElement.lang on mount", () => {
    renderHook(() => useDocumentLocaleLang("de"));

    expect(document.documentElement.lang).toBe("de");
  });

  it("updates documentElement.lang when locale changes and leaves it in place on unmount", () => {
    const { rerender, unmount } = renderHook(
      ({ locale }) => useDocumentLocaleLang(locale),
      { initialProps: { locale: "en" } },
    );

    expect(document.documentElement.lang).toBe("en");

    rerender({ locale: "es" });
    expect(document.documentElement.lang).toBe("es");

    unmount();
    expect(document.documentElement.lang).toBe("es");
  });
});
