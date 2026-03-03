#!/usr/bin/env python3
"""
Audit translation catalog parity and untranslated strings.

By default, treats `en` as the source-of-truth and reports:
- leaf key paths missing in the locale file
- leaf key paths extra in the locale file
- leaf key paths where locale value is identical to source (likely untranslated)

Usage examples:
  python3 scripts/i18n-audit-locale.py --source apps/web/messages/en.json --locale apps/web/messages/fr.json
  python3 scripts/i18n-audit-locale.py --source apps/web/messages/en.json --locale apps/web/messages/es.json --write-json apps/web/messages/_es_audit.json
  python3 scripts/i18n-audit-locale.py --source apps/web/messages/en.json --locale apps/web/messages/fr.json --print-keys same --group-top-level
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Tuple


def flatten_leaf_strings(obj: Any, prefix: str = "") -> Dict[str, str]:
    out: Dict[str, str] = {}
    if isinstance(obj, dict):
        for key, value in obj.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            out.update(flatten_leaf_strings(value, path))
        return out
    if isinstance(obj, str):
        out[prefix] = obj
    return out


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def group_by_top_level(keys: List[str]) -> Dict[str, List[str]]:
    grouped: Dict[str, List[str]] = defaultdict(list)
    for key in keys:
        top = key.split(".", 1)[0]
        grouped[top].append(key)
    return {k: grouped[k] for k in sorted(grouped)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path, help="Source catalog (e.g. en.json)")
    parser.add_argument("--locale", required=True, type=Path, help="Locale catalog to audit (e.g. fr.json)")
    parser.add_argument(
        "--top-level",
        default=None,
        help="If set, filters printed keys (and written JSON lists) to this top-level namespace (e.g. Auth, App).",
    )
    parser.add_argument(
        "--print-keys",
        choices=["missing", "extra", "same", "none"],
        default="none",
        help="Print full key list for a category",
    )
    parser.add_argument(
        "--group-top-level",
        action="store_true",
        help="Group printed keys by top-level namespace",
    )
    parser.add_argument(
        "--write-json",
        type=Path,
        default=None,
        help="Write full audit output as JSON to this path",
    )
    args = parser.parse_args()

    source_obj = read_json(args.source)
    locale_obj = read_json(args.locale)

    source_flat = flatten_leaf_strings(source_obj)
    locale_flat = flatten_leaf_strings(locale_obj)

    missing = sorted([k for k in source_flat.keys() if k not in locale_flat])
    extra = sorted([k for k in locale_flat.keys() if k not in source_flat])
    same = sorted([k for k in source_flat.keys() if k in locale_flat and locale_flat[k] == source_flat[k]])

    def filter_top(keys: List[str]) -> List[str]:
        if not args.top_level:
            return keys
        prefix = f"{args.top_level}."
        return [k for k in keys if k.startswith(prefix)]

    missing_filtered = filter_top(missing)
    extra_filtered = filter_top(extra)
    same_filtered = filter_top(same)

    summary = {
        "leaf_keys_source": len(source_flat),
        "leaf_keys_locale": len(locale_flat),
        "missing_in_locale": missing_filtered,
        "extra_in_locale": extra_filtered,
        "same_value_as_source": same_filtered,
        "top_level_filter": args.top_level,
        "counts": {
            "missing_in_locale": len(missing_filtered),
            "extra_in_locale": len(extra_filtered),
            "same_value_as_source": len(same_filtered),
        },
        "same_value_group_counts": {
            k: len(v)
            for k, v in sorted(
                group_by_top_level(same_filtered).items(),
                key=lambda kv: (-len(kv[1]), kv[0]),
            )
        },
    }

    print(f"source: {args.source}")
    print(f"locale: {args.locale}")
    print(f"leaf_keys_source: {summary['leaf_keys_source']}")
    print(f"leaf_keys_locale: {summary['leaf_keys_locale']}")
    print(f"missing_in_locale: {summary['counts']['missing_in_locale']}")
    print(f"extra_in_locale: {summary['counts']['extra_in_locale']}")
    print(f"same_value_as_source: {summary['counts']['same_value_as_source']}")
    if args.top_level:
        print(f"top_level_filter: {args.top_level}")
    print("")
    print("Top-level group counts (same-value-as-source):")
    for k, v in summary["same_value_group_counts"].items():
        print(f"- {k}: {v}")

    if args.print_keys != "none":
        key_map = {
            "missing": summary["missing_in_locale"],
            "extra": summary["extra_in_locale"],
            "same": summary["same_value_as_source"],
        }
        keys = key_map[args.print_keys]
        print("")
        print(f"Keys ({args.print_keys}) [{len(keys)}]:")
        if args.group_top_level:
            grouped = group_by_top_level(keys)
            for top in sorted(grouped):
                print(f"\n[{top}] ({len(grouped[top])})")
                for key in grouped[top]:
                    print(key)
        else:
            for key in keys:
                print(key)

    if args.write_json is not None:
        args.write_json.parent.mkdir(parents=True, exist_ok=True)
        args.write_json.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("")
        print(f"Wrote JSON audit to: {args.write_json}")


if __name__ == "__main__":
    main()

