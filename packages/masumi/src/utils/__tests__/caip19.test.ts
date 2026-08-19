import { describe, expect, it } from "vitest";

import {
  buildCaip19AssetKey,
  isCaip19AssetKey,
  isEvmNamespacedUnit,
  parseCaip19AssetKey,
} from "../caip19.js";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_BASE_LOWER = USDC_BASE.toLowerCase();

describe("buildCaip19AssetKey", () => {
  it("builds the canonical lowercase key", () => {
    expect(buildCaip19AssetKey("eip155:8453", USDC_BASE)).toBe(
      `eip155:8453/erc20:${USDC_BASE_LOWER}`,
    );
  });

  it("lowercases mixed-case network and address input", () => {
    expect(
      buildCaip19AssetKey(
        "EIP155:84532",
        USDC_BASE.toUpperCase().replace("0X", "0x"),
      ),
    ).toBe(`eip155:84532/erc20:${USDC_BASE_LOWER}`);
  });

  it("trims surrounding whitespace", () => {
    expect(buildCaip19AssetKey(" eip155:8453 ", ` ${USDC_BASE} `)).toBe(
      `eip155:8453/erc20:${USDC_BASE_LOWER}`,
    );
  });

  it("throws on a non-CAIP-2 network", () => {
    expect(() => buildCaip19AssetKey("base", USDC_BASE)).toThrow(
      /Invalid CAIP-2 EVM network/,
    );
    expect(() => buildCaip19AssetKey("eip155:", USDC_BASE)).toThrow(
      /Invalid CAIP-2 EVM network/,
    );
    expect(() => buildCaip19AssetKey("cosmos:cosmoshub-4", USDC_BASE)).toThrow(
      /Invalid CAIP-2 EVM network/,
    );
  });

  it("refuses non-canonical chain-id spellings (leading zeros, overlong)", () => {
    // The pattern DECIDES canonical spelling: a leading-zero chain id that
    // passed here would mint a second unit key for the same chain.
    expect(() => buildCaip19AssetKey("eip155:08453", USDC_BASE)).toThrow(
      /Invalid CAIP-2 EVM network/,
    );
    expect(() => buildCaip19AssetKey("eip155:00", USDC_BASE)).toThrow(
      /Invalid CAIP-2 EVM network/,
    );
    expect(() =>
      buildCaip19AssetKey(`eip155:1${"0".repeat(32)}`, USDC_BASE),
    ).toThrow(/Invalid CAIP-2 EVM network/);
    // CAIP-2 canonical zero stays a single "0".
    expect(buildCaip19AssetKey("eip155:0", USDC_BASE)).toBe(
      `eip155:0/erc20:${USDC_BASE_LOWER}`,
    );
  });

  it("throws on a malformed asset address", () => {
    expect(() => buildCaip19AssetKey("eip155:8453", "USDC")).toThrow(
      /Invalid ERC-20 asset address/,
    );
    expect(() => buildCaip19AssetKey("eip155:8453", "0x1234")).toThrow(
      /Invalid ERC-20 asset address/,
    );
    expect(() => buildCaip19AssetKey("eip155:8453", `${USDC_BASE}00`)).toThrow(
      /Invalid ERC-20 asset address/,
    );
  });
});

describe("parseCaip19AssetKey", () => {
  it("round-trips a built key", () => {
    const key = buildCaip19AssetKey("eip155:8453", USDC_BASE);
    expect(parseCaip19AssetKey(key)).toEqual({
      caip2Network: "eip155:8453",
      assetAddress: USDC_BASE_LOWER,
    });
  });

  it("accepts mixed-case stored keys and returns lowercase parts", () => {
    expect(parseCaip19AssetKey(`EIP155:8453/ERC20:${USDC_BASE}`)).toEqual({
      caip2Network: "eip155:8453",
      assetAddress: USDC_BASE_LOWER,
    });
  });

  it("returns null for Cardano units and other non-CAIP-19 keys", () => {
    expect(parseCaip19AssetKey("lovelace")).toBeNull();
    expect(parseCaip19AssetKey("")).toBeNull();
    expect(
      parseCaip19AssetKey(
        "8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61446a65644d6963726f555344",
      ),
    ).toBeNull();
    expect(parseCaip19AssetKey("eip155:8453")).toBeNull();
    expect(parseCaip19AssetKey(`erc20:${USDC_BASE_LOWER}`)).toBeNull();
    expect(
      parseCaip19AssetKey(`eip155:8453/erc721:${USDC_BASE_LOWER}`),
    ).toBeNull();
    expect(parseCaip19AssetKey("eip155:8453/erc20:0x1234")).toBeNull();
  });

  it("returns null for non-canonical chain-id spellings", () => {
    expect(
      parseCaip19AssetKey(`eip155:08453/erc20:${USDC_BASE_LOWER}`),
    ).toBeNull();
    expect(
      parseCaip19AssetKey(`eip155:1${"0".repeat(32)}/erc20:${USDC_BASE_LOWER}`),
    ).toBeNull();
  });
});

describe("isCaip19AssetKey", () => {
  it("recognizes CAIP-19 keys and rejects everything else", () => {
    expect(isCaip19AssetKey(`eip155:84532/erc20:${USDC_BASE_LOWER}`)).toBe(
      true,
    );
    expect(isCaip19AssetKey("lovelace")).toBe(false);
  });
});

describe("isEvmNamespacedUnit", () => {
  it("catches the whole eip155 namespace, misspellings included", () => {
    // The EXCLUSION fence: broader than isCaip19AssetKey by design, so a
    // malformed key can never fall through to per-smallest-unit pricing.
    expect(isEvmNamespacedUnit(`eip155:84532/erc20:${USDC_BASE_LOWER}`)).toBe(
      true,
    );
    expect(isEvmNamespacedUnit("eip155:084532/erc20:junk")).toBe(true);
    expect(isEvmNamespacedUnit(" EIP155:8453 ")).toBe(true);
    expect(isEvmNamespacedUnit("lovelace")).toBe(false);
    expect(isEvmNamespacedUnit("")).toBe(false);
    expect(
      isEvmNamespacedUnit(
        "8db269c3ec630e06ae29f74bc39edd1f87c819f1056206e879a1cd61446a65644d6963726f555344",
      ),
    ).toBe(false);
  });
});
