import { afterEach, describe, expect, it } from "vitest";

import { focusableWithin, hideOthers } from "./use-modal-overlay";

/**
 * The two pieces of the modal contract that are worth testing apart from the
 * studio: what gets taken out of play, and what counts as a tab stop.
 */

afterEach(() => {
  document.body.innerHTML = "";
});

function build(html: string): HTMLElement {
  document.body.innerHTML = html;
  const kept = document.querySelector<HTMLElement>("#kept");
  if (!kept) throw new Error("the fixture has no #kept");
  return kept;
}

describe("hideOthers", () => {
  it("takes every branch but the kept one out of play, and puts it back", () => {
    const kept = build(`
      <header id="header"><button id="menu">menu</button></header>
      <main id="main">
        <div id="gallery"><button id="image">image</button></div>
        <div id="wrapper"><div id="kept"><button id="close">close</button></div></div>
      </main>
      <footer id="footer">footer</footer>
    `);

    const release = hideOthers(kept);

    // Siblings all the way up: the gallery beside it, the header and footer
    // beside its `main`.
    for (const id of ["gallery", "header", "footer"]) {
      expect(document.getElementById(id)).toHaveAttribute("inert");
    }
    // Never the kept element, its own contents, or the ancestors that hold it.
    for (const id of ["kept", "close", "wrapper", "main"]) {
      expect(document.getElementById(id)).not.toHaveAttribute("inert");
    }

    release();
    for (const id of ["gallery", "header", "footer"]) {
      expect(document.getElementById(id)).not.toHaveAttribute("inert");
    }
  });

  it("leaves an element that was already inert alone", () => {
    const kept = build(`
      <main>
        <div id="already" inert>already hidden</div>
        <div id="kept"></div>
      </main>
    `);

    const release = hideOthers(kept);
    release();

    // Releasing must not un-hide something another overlay is still hiding.
    expect(document.getElementById("already")).toHaveAttribute("inert");
  });
});

describe("focusableWithin", () => {
  it("lists what a Tab press can actually reach, in document order", () => {
    const kept = build(`
      <div id="kept">
        <button id="one">one</button>
        <button id="off" disabled>disabled</button>
        <a id="two" href="#x">link</a>
        <a id="nohref">not a link</a>
        <textarea id="three"></textarea>
        <div id="four" tabindex="0"></div>
        <div id="skip" tabindex="-1"></div>
        <button id="hidden" hidden>hidden</button>
        <button id="ariahidden" aria-hidden="true">announced to nobody</button>
      </div>
    `);

    expect(focusableWithin(kept).map((element) => element.id)).toEqual([
      "one",
      "two",
      "three",
      "four",
    ]);
  });
});
