import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { pageTextMatches } from "./page-text-matches";

it("matches across inline markup and keeps adjacent dashboard rows separate", () => {
  const { container } = render(
    <section>
      <p>
        Launch <strong>status</strong>
      </p>
      <p>summary</p>
      <div hidden>Launch status</div>
    </section>,
  );
  const [range] = pageTextMatches(container, "launch status");
  expect(range?.toString()).toBe("Launch status");
  expect(range?.endContainer.parentElement?.tagName).toBe("STRONG");
  expect(pageTextMatches(container, "statussummary")).toEqual([]);
});

it("searches the summary of a closed disclosure and its contents after it opens", () => {
  const { container } = render(
    <details>
      <summary>Audit finding</summary>
      <p>Audit evidence</p>
    </details>,
  );
  expect(pageTextMatches(container, "audit")).toHaveLength(1);
  const details = container.querySelector("details");
  expect(details).toBeTruthy();
  details?.setAttribute("open", "");
  expect(pageTextMatches(container, "audit")).toHaveLength(2);
});
