import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { Mascot } from "./mascot";

it("shows Cuso walking by default, as decoration", () => {
  const html = renderToStaticMarkup(<Mascot className="hero-mascot" />);
  expect(html).toContain('class="mascot hero-mascot"');
  expect(html).toContain('src="/cuso/walking.png"');
  expect(html).toContain('alt=""');
});

it("shows the pose it is given", () => {
  expect(renderToStaticMarkup(<Mascot art="thinking" />)).toContain(
    'src="/cuso/thinking.png"',
  );
});
