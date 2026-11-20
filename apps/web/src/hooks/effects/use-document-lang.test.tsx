import { render, renderHook } from "@testing-library/react";
import { Activity } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useDocumentLang } from "./use-document-lang";

function LangMarker({ lang }: { lang: string }) {
  useDocumentLang(lang);
  return null;
}

describe("useDocumentLang", () => {
  const initialLang = document.documentElement.lang;

  afterEach(() => {
    document.documentElement.lang = initialLang;
  });

  it("sets documentElement.lang on mount and restores the previous lang on unmount", () => {
    document.documentElement.lang = "en";

    const { unmount } = renderHook(() => useDocumentLang("de"));

    expect(document.documentElement.lang).toBe("de");

    unmount();

    expect(document.documentElement.lang).toBe("en");
  });

  it("updates documentElement.lang when lang changes", () => {
    const { rerender } = renderHook(({ lang }) => useDocumentLang(lang), {
      initialProps: { lang: "en" },
    });

    expect(document.documentElement.lang).toBe("en");

    rerender({ lang: "es" });

    expect(document.documentElement.lang).toBe("es");
  });

  it("restores the outer owner when an inner Activity owner hides, and reveals back to inner", () => {
    document.documentElement.lang = "en";

    const { rerender, unmount } = render(
      <>
        <Activity mode="visible">
          <LangMarker lang="de" />
        </Activity>
        <Activity mode="visible">
          <LangMarker lang="es" />
        </Activity>
      </>,
    );

    expect(document.documentElement.lang).toBe("es");

    rerender(
      <>
        <Activity mode="visible">
          <LangMarker lang="de" />
        </Activity>
        <Activity mode="hidden">
          <LangMarker lang="es" />
        </Activity>
      </>,
    );
    expect(document.documentElement.lang).toBe("de");

    rerender(
      <>
        <Activity mode="visible">
          <LangMarker lang="de" />
        </Activity>
        <Activity mode="visible">
          <LangMarker lang="es" />
        </Activity>
      </>,
    );
    expect(document.documentElement.lang).toBe("es");

    unmount();
    expect(document.documentElement.lang).toBe("en");
  });

  it("keeps the inner owner's lang when the outer Activity owner hides first", () => {
    document.documentElement.lang = "en";

    const { rerender } = render(
      <>
        <Activity mode="visible">
          <LangMarker lang="de" />
        </Activity>
        <Activity mode="visible">
          <LangMarker lang="es" />
        </Activity>
      </>,
    );

    expect(document.documentElement.lang).toBe("es");

    rerender(
      <>
        <Activity mode="hidden">
          <LangMarker lang="de" />
        </Activity>
        <Activity mode="visible">
          <LangMarker lang="es" />
        </Activity>
      </>,
    );
    expect(document.documentElement.lang).toBe("es");

    rerender(
      <>
        <Activity mode="hidden">
          <LangMarker lang="de" />
        </Activity>
        <Activity mode="hidden">
          <LangMarker lang="es" />
        </Activity>
      </>,
    );
    expect(document.documentElement.lang).toBe("en");
  });
});
