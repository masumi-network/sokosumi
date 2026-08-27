import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import AgentFullbleedEffect from "./agent-fullbleed-effect";

describe("AgentFullbleedEffect", () => {
  afterEach(() => {
    delete document.body.dataset.agentFullbleed;
  });

  it("sets body data-agent-fullbleed on mount and clears on unmount", () => {
    expect(document.body.dataset.agentFullbleed).toBeUndefined();

    const { unmount } = render(<AgentFullbleedEffect />);

    expect(document.body.dataset.agentFullbleed).toBe("true");
    expect(document.body.getAttribute("data-agent-fullbleed")).toBe("true");

    unmount();

    expect(document.body.dataset.agentFullbleed).toBeUndefined();
    expect(document.body.hasAttribute("data-agent-fullbleed")).toBe(false);
  });
});
