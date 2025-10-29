import { hasHtmlContent } from "@/lib/utils/html-detection";

/**
 * Tests for HTML detection logic used in DOCX export
 */
describe("HTML Detection - hasHtmlContent", () => {
  describe("should correctly identify HTML content", () => {
    it("detects paragraph tags", () => {
      expect(hasHtmlContent("<p>Test paragraph</p>")).toBe(true);
      expect(hasHtmlContent("<p >Test with space</p>")).toBe(true);
      expect(hasHtmlContent("<p\n>Test with newline</p>")).toBe(true);
    });

    it("detects div tags", () => {
      expect(hasHtmlContent("<div>Content</div>")).toBe(true);
      expect(hasHtmlContent('<div class="test">Content</div>')).toBe(true);
    });

    it("detects table tags", () => {
      expect(hasHtmlContent("<table><tr><td>Cell</td></tr></table>")).toBe(
        true,
      );
      expect(hasHtmlContent("<table >Header</table>")).toBe(true);
    });

    it("detects heading tags", () => {
      expect(hasHtmlContent("<h1>Title</h1>")).toBe(true);
      expect(hasHtmlContent("<h2>Subtitle</h2>")).toBe(true);
      expect(hasHtmlContent("<h3>Section</h3>")).toBe(true);
      expect(hasHtmlContent("<h4>Subsection</h4>")).toBe(true);
      expect(hasHtmlContent("<h5>Minor heading</h5>")).toBe(true);
      expect(hasHtmlContent("<h6>Smallest heading</h6>")).toBe(true);
    });

    it("detects list tags", () => {
      expect(hasHtmlContent("<ul><li>Item</li></ul>")).toBe(true);
      expect(hasHtmlContent("<ol><li>Item</li></ol>")).toBe(true);
      expect(hasHtmlContent("<li>List item</li>")).toBe(true);
    });

    it("detects inline formatting tags", () => {
      expect(hasHtmlContent("<strong>Bold</strong>")).toBe(true);
      expect(hasHtmlContent("<em>Italic</em>")).toBe(true);
      expect(hasHtmlContent("<span>Text</span>")).toBe(true);
    });

    it("detects other common tags", () => {
      expect(hasHtmlContent('<a href="#">Link</a>')).toBe(true);
      expect(hasHtmlContent('<img src="test.png" />')).toBe(true);
      expect(hasHtmlContent("<br>")).toBe(true);
      expect(hasHtmlContent("<br />")).toBe(true);
      expect(hasHtmlContent("<hr>")).toBe(true);
      expect(hasHtmlContent("<blockquote>Quote</blockquote>")).toBe(true);
    });

    it("handles mixed case tags", () => {
      expect(hasHtmlContent("<P>Test</P>")).toBe(true);
      expect(hasHtmlContent("<DIV>Test</DIV>")).toBe(true);
      expect(hasHtmlContent("<Table>Test</Table>")).toBe(true);
    });

    it("detects HTML5 semantic tags", () => {
      expect(hasHtmlContent("<article>Content</article>")).toBe(true);
      expect(hasHtmlContent("<section>Section content</section>")).toBe(true);
      expect(hasHtmlContent("<nav>Navigation</nav>")).toBe(true);
      expect(hasHtmlContent("<aside>Sidebar</aside>")).toBe(true);
      expect(hasHtmlContent("<header>Header</header>")).toBe(true);
      expect(hasHtmlContent("<footer>Footer</footer>")).toBe(true);
      expect(hasHtmlContent("<main>Main content</main>")).toBe(true);
      expect(hasHtmlContent("<figure><img src='test.jpg'/></figure>")).toBe(
        true,
      );
      expect(hasHtmlContent("<figcaption>Caption</figcaption>")).toBe(true);
    });

    it("detects form-related tags", () => {
      expect(hasHtmlContent("<form>Form content</form>")).toBe(true);
      expect(hasHtmlContent('<input type="text" />')).toBe(true);
      expect(hasHtmlContent("<button>Click me</button>")).toBe(true);
      expect(hasHtmlContent("<select><option>Option</option></select>")).toBe(
        true,
      );
      expect(hasHtmlContent("<textarea>Text area</textarea>")).toBe(true);
      expect(hasHtmlContent("<label>Label text</label>")).toBe(true);
    });

    it("detects media tags", () => {
      expect(hasHtmlContent('<video src="video.mp4"></video>')).toBe(true);
      expect(hasHtmlContent('<audio src="audio.mp3"></audio>')).toBe(true);
      expect(hasHtmlContent("<canvas></canvas>")).toBe(true);
      expect(hasHtmlContent('<svg viewBox="0 0 100 100"></svg>')).toBe(true);
    });
  });

  describe("should not detect HTML in non-HTML content", () => {
    it("ignores comparison operators", () => {
      expect(hasHtmlContent("a < b and c > d")).toBe(false);
      expect(hasHtmlContent("if (x < 10 && y > 5)")).toBe(false);
      expect(hasHtmlContent("1 < 2")).toBe(false);
    });

    it("ignores generic brackets", () => {
      expect(hasHtmlContent("List<String>")).toBe(false);
      expect(hasHtmlContent("Map<String, Integer>")).toBe(false);
      expect(hasHtmlContent("array<number>")).toBe(false);
    });

    it("ignores non-HTML tags", () => {
      expect(hasHtmlContent("<custom>Not HTML</custom>")).toBe(false);
      expect(hasHtmlContent("<foo>Bar</foo>")).toBe(false);
      expect(hasHtmlContent("<123>Numbers</123>")).toBe(false);
    });

    it("returns false for content without < character", () => {
      expect(hasHtmlContent("Plain text content")).toBe(false);
      expect(hasHtmlContent("# Markdown heading")).toBe(false);
      expect(hasHtmlContent("**Bold markdown**")).toBe(false);
      expect(hasHtmlContent("[Link](url)")).toBe(false);
    });

    it("returns false for empty or whitespace", () => {
      expect(hasHtmlContent("")).toBe(false);
      expect(hasHtmlContent(" ")).toBe(false);
      expect(hasHtmlContent("\n")).toBe(false);
      expect(hasHtmlContent("\t")).toBe(false);
    });
  });

  describe("edge cases", () => {
    it("handles HTML comments", () => {
      // HTML comments are not detected as they're not in our tag list
      expect(hasHtmlContent("<!-- Comment -->")).toBe(false);
    });

    it("handles self-closing tags", () => {
      // Note: br/> without space doesn't match our pattern (needs space or >)
      expect(hasHtmlContent("<br/>")).toBe(false);
      expect(hasHtmlContent("<br>")).toBe(true);
      expect(hasHtmlContent("<br >")).toBe(true);
      expect(hasHtmlContent("<br />")).toBe(true);
      expect(hasHtmlContent("<img />")).toBe(true);
      expect(hasHtmlContent("<hr />")).toBe(true);
      expect(hasHtmlContent("<hr>")).toBe(true);
    });

    it("handles tags with attributes", () => {
      expect(hasHtmlContent('<p class="test">Text</p>')).toBe(true);
      expect(hasHtmlContent('<div id="main">Content</div>')).toBe(true);
      expect(
        hasHtmlContent('<table border="1"><tr><td>Cell</td></tr></table>'),
      ).toBe(true);
    });

    it("handles nested tags", () => {
      expect(
        hasHtmlContent("<div><p>Nested <strong>content</strong></p></div>"),
      ).toBe(true);
    });

    it("handles malformed HTML", () => {
      expect(hasHtmlContent("<p>Unclosed paragraph")).toBe(true);
      expect(hasHtmlContent("<div><p>Mismatched</div>")).toBe(true);
    });
  });
});
