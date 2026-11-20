import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useDocumentLang } from "./use-document-lang";

describe("useDocumentLang", () => {
  const initialLang = document.documentElement.lang;

  afterEach(() => {
    document.documentElement.lang = initialLang;
  });

  it("sets documentElement.lang on mount", () => {
    renderHook(() => useDocumentLang("de"));

    expect(document.documentElement.lang).toBe("de");
  });

  it("updates documentElement.lang when lang changes", () => {
    const { rerender } = renderHook(({ lang }) => useDocumentLang(lang), {
      initialProps: { lang: "en" },
    });

    expect(document.documentElement.lang).toBe("en");

    rerender({ lang: "es" });

    expect(document.documentElement.lang).toBe("es");
  });
});
