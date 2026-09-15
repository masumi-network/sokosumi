import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TIME_FORMAT_COOKIE_NAME } from "@/i18n/time-format";

import { PreferencesSection } from "./preferences-section";

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations:
    (namespace: string) => (key: string, values?: Record<string, string>) =>
      [`${namespace}.${key}`, ...Object.values(values ?? {})].join(" "),
}));

/** Auto's label names what it resolves to: the browser's own convention. */
const AUTO_24H =
  "App.Account.TimeFormat.autoResolved App.Account.TimeFormat.options.24h";

function stubBrowserHourCycle(
  hourCycle: Intl.ResolvedDateTimeFormatOptions["hourCycle"],
) {
  const resolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(
    function (this: Intl.DateTimeFormat) {
      return { ...resolvedOptions.call(this), hourCycle };
    },
  );
}

function clearTimeFormatCookie() {
  document.cookie = `${TIME_FORMAT_COOKIE_NAME}=; path=/; max-age=0`;
}

function chooseTimeFormat(optionName: string) {
  fireEvent.click(
    screen.getByRole("combobox", {
      name: "App.Account.TimeFormat.selectAriaLabel",
    }),
  );
  fireEvent.click(screen.getByRole("option", { name: optionName }));
}

describe("PreferencesSection time format", () => {
  const reload = vi.fn();

  beforeEach(() => {
    reload.mockClear();
    vi.spyOn(window.location, "reload").mockImplementation(reload);
    stubBrowserHourCycle("h23");
    clearTimeFormatCookie();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearTimeFormatCookie();
  });

  it("stores an explicit 24-hour choice and reloads", () => {
    render(<PreferencesSection />);

    chooseTimeFormat("App.Account.TimeFormat.options.24h");

    expect(document.cookie).toContain(`${TIME_FORMAT_COOKIE_NAME}=24h`);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("goes back to Auto by deleting the stored choice", () => {
    document.cookie = `${TIME_FORMAT_COOKIE_NAME}=24h; path=/`;
    render(<PreferencesSection />);

    chooseTimeFormat(AUTO_24H);

    expect(document.cookie).not.toContain(`${TIME_FORMAT_COOKIE_NAME}=`);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
