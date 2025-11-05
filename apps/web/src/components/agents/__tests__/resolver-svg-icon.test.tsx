import "@testing-library/jest-dom";
import { render, waitFor } from "@testing-library/react";

import { ResolverSVGIcon } from "@/components/agents/resolver-svg-icon";

jest.mock("dompurify", () => ({
  __esModule: true,
  default: {
    sanitize: jest.fn((svg: string) => svg),
  },
}));

jest.mock("@/lib/ipfs", () => ({
  ipfsUrlResolver: jest.fn((url: string | null) => url || null),
}));

jest.mock("next/image", () => ({
  __esModule: true,
  default: (props: {
    src: string;
    alt: string;
    width: number;
    height: number;
    className?: string;
    style?: React.CSSProperties;
  }) => {
    return (
      <img
        src={props.src}
        alt={props.alt}
        width={props.width}
        height={props.height}
        className={props.className}
        style={props.style}
        data-testid="fallback-image"
      />
    );
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe("ResolverSVGIcon", () => {
  let mockSanitize: jest.Mock;
  let mockIpfsUrlResolver: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockClear();

    const DOMPurify = require("dompurify");
    mockSanitize = DOMPurify.default.sanitize;
    mockSanitize.mockClear();

    const ipfsModule = require("@/lib/ipfs");
    mockIpfsUrlResolver = ipfsModule.ipfsUrlResolver;
    mockIpfsUrlResolver.mockClear();
  });

  it("should render valid SVG content", async () => {
    const validSvg = '<svg><circle cx="50" cy="50" r="40"/></svg>';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: () => "image/svg+xml",
      },
      text: async () => validSvg,
    });

    const { container } = render(
      <ResolverSVGIcon svgUrl="https://example.com/icon.svg" />,
    );

    await waitFor(() => {
      const svgElement = container.querySelector("svg");
      expect(svgElement).toBeInTheDocument();
    });
  });

  it("should sanitize and remove script tags from SVG", async () => {
    const maliciousSvg = '<svg><script>alert("xss")</script><circle/></svg>';
    const sanitizedSvg = "<svg><circle/></svg>";
    mockSanitize.mockReturnValueOnce(sanitizedSvg);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: () => "image/svg+xml",
      },
      text: async () => maliciousSvg,
    });

    const { container } = render(
      <ResolverSVGIcon svgUrl="https://example.com/icon.svg" />,
    );

    await waitFor(() => {
      expect(mockSanitize).toHaveBeenCalledWith(
        maliciousSvg,
        expect.any(Object),
      );
      const scriptTag = container.querySelector("script");
      expect(scriptTag).not.toBeInTheDocument();
    });
  });

  it("should sanitize and remove style tags from SVG", async () => {
    const maliciousSvg = "<svg><style>body{color:red}</style><circle/></svg>";
    const sanitizedSvg = "<svg><circle/></svg>";
    mockSanitize.mockReturnValueOnce(sanitizedSvg);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: () => "image/svg+xml",
      },
      text: async () => maliciousSvg,
    });

    const { container } = render(
      <ResolverSVGIcon svgUrl="https://example.com/icon.svg" />,
    );

    await waitFor(() => {
      expect(mockSanitize).toHaveBeenCalled();
      const styleTag = container.querySelector("style");
      expect(styleTag).not.toBeInTheDocument();
    });
  });

  it("should sanitize and remove event handlers from SVG", async () => {
    const maliciousSvg = '<svg><circle onclick="alert(1)"/></svg>';
    const sanitizedSvg = "<svg><circle/></svg>";
    mockSanitize.mockReturnValueOnce(sanitizedSvg);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: () => "image/svg+xml",
      },
      text: async () => maliciousSvg,
    });

    const { container } = render(
      <ResolverSVGIcon svgUrl="https://example.com/icon.svg" />,
    );

    await waitFor(() => {
      expect(mockSanitize).toHaveBeenCalled();
      const circle = container.querySelector("circle");
      expect(circle?.getAttribute("onclick")).toBeNull();
    });
  });

  it("should preserve valid SVG structure after sanitization", async () => {
    const validSvg =
      '<svg><circle cx="50" cy="50" r="40"/><rect x="10" y="10" width="20" height="20"/></svg>';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: () => "image/svg+xml",
      },
      text: async () => validSvg,
    });

    const { container } = render(
      <ResolverSVGIcon svgUrl="https://example.com/icon.svg" />,
    );

    await waitFor(() => {
      const svgElement = container.querySelector("svg");
      const circle = container.querySelector("circle");
      const rect = container.querySelector("rect");
      expect(svgElement).toBeInTheDocument();
      expect(circle).toBeInTheDocument();
      expect(rect).toBeInTheDocument();
    });
  });

  it("should handle fetch timeout gracefully", async () => {
    mockFetch.mockImplementationOnce(() => {
      return new Promise((_, reject) => {
        setTimeout(() => reject(new Error("AbortError")), 100);
      });
    });

    const { container } = render(
      <ResolverSVGIcon svgUrl="https://example.com/icon.svg" />,
    );

    await waitFor(
      () => {
        const image = container.querySelector('[data-testid="fallback-image"]');
        expect(image).toBeInTheDocument();
      },
      { timeout: 6000 },
    );
  });

  // Test case 7: Fallback behavior - should fallback to Image component
  it("should fallback to Image component when SVG fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: () => "image/png",
      },
      text: async () => "not an svg",
    });

    const { container } = render(
      <ResolverSVGIcon svgUrl="https://example.com/icon.png" />,
    );

    await waitFor(() => {
      const image = container.querySelector('[data-testid="fallback-image"]');
      expect(image).toBeInTheDocument();
      expect(image).toHaveAttribute("src", "https://example.com/icon.png");
    });
  });

  it("should return null when svgUrl is null", () => {
    const { container } = render(<ResolverSVGIcon svgUrl={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("should replace fill and stroke attributes with currentColor", async () => {
    const svgWithColors =
      '<svg><circle fill="#ff0000" stroke="#00ff00"/></svg>';
    const sanitizedSvg = '<svg><circle fill="#ff0000" stroke="#00ff00"/></svg>';
    mockSanitize.mockReturnValueOnce(sanitizedSvg);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: () => "image/svg+xml",
      },
      text: async () => svgWithColors,
    });

    const { container } = render(
      <ResolverSVGIcon svgUrl="https://example.com/icon.svg" />,
    );

    await waitFor(() => {
      const circle = container.querySelector("circle");
      expect(circle).toBeInTheDocument();
      expect(circle?.getAttribute("fill")).toBe("currentColor");
      expect(circle?.getAttribute("stroke")).toBe("currentColor");
    });
  });

  it("should preserve fill/stroke='none' attributes", async () => {
    const svgWithNone = '<svg><circle fill="none" stroke="none"/></svg>';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: () => "image/svg+xml",
      },
      text: async () => svgWithNone,
    });

    const { container } = render(
      <ResolverSVGIcon svgUrl="https://example.com/icon.svg" />,
    );

    await waitFor(() => {
      const circle = container.querySelector("circle");
      expect(circle).toBeInTheDocument();
      expect(circle?.getAttribute("fill")).toBe("none");
      expect(circle?.getAttribute("stroke")).toBe("none");
    });
  });

  it("should clean SVG tag attributes", async () => {
    const svgWithDimensions = '<svg width="100" height="100"><circle/></svg>';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: () => "image/svg+xml",
      },
      text: async () => svgWithDimensions,
    });

    const { container } = render(
      <ResolverSVGIcon svgUrl="https://example.com/icon.svg" />,
    );

    await waitFor(() => {
      const svgElement = container.querySelector("svg");
      expect(svgElement).toBeInTheDocument();
      expect(svgElement?.getAttribute("width")).toBeNull();
      expect(svgElement?.getAttribute("height")).toBeNull();
      expect(svgElement?.getAttribute("preserveAspectRatio")).toBe(
        "xMidYMid meet",
      );
    });
  });

  it.skip("should handle server-side rendering without DOMPurify", async () => {});

  it("should accept SVG based on content-type header", async () => {
    const validSvg = "<svg><circle/></svg>";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: () => "image/svg+xml",
      },
      text: async () => validSvg,
    });

    const { container } = render(
      <ResolverSVGIcon svgUrl="https://example.com/icon.svg" />,
    );

    await waitFor(() => {
      const svgElement = container.querySelector("svg");
      expect(svgElement).toBeInTheDocument();
    });
  });

  it("should accept SVG based on content pattern when content-type is missing", async () => {
    const validSvg = "<svg><circle/></svg>";
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: {
        get: () => null,
      },
      text: async () => validSvg,
    });

    const { container } = render(
      <ResolverSVGIcon svgUrl="https://example.com/icon.svg" />,
    );

    await waitFor(() => {
      const svgElement = container.querySelector("svg");
      expect(svgElement).toBeInTheDocument();
    });
  });

  it("should handle fetch errors gracefully", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));

    const { container } = render(
      <ResolverSVGIcon svgUrl="https://example.com/icon.svg" />,
    );

    await waitFor(() => {
      const image = container.querySelector('[data-testid="fallback-image"]');
      expect(image).toBeInTheDocument();
    });
  });
});
