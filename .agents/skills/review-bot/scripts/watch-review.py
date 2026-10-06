#!/usr/bin/env python3
"""Watch open PRs for a `/<reviewer> review` issue comment. Print ACTION_REQUIRED once per comment."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

SEARCH_QUERY = """
query($search: String!) {
  search(query: $search, type: ISSUE, first: 50) {
    issueCount
    nodes {
      ... on PullRequest {
        number
        url
        comments(last: 30) {
          nodes {
            databaseId
            url
            body
            createdAt
            author { login }
          }
        }
      }
    }
  }
}
""".strip()


REVIEWER_ENV_VAR = "REVIEW_BOT_REVIEWER"
KNOWN_REVIEWERS = ("grok", "muse", "claude", "cursor", "codex")


def normalize_reviewer(raw: str) -> str:
    reviewer = raw.strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-_]*", reviewer):
        raise ValueError(f"invalid reviewer {raw!r}: use a lowercase name like 'muse'")
    return reviewer


def trigger_prefix(reviewer: str) -> str:
    return f"/{reviewer} review"


def is_trigger(body: str, reviewer: str) -> bool:
    if not body:
        return False
    prefix = trigger_prefix(reviewer)
    for raw in body.splitlines():
        line = raw.strip()
        if not line:
            continue
        lower = line.lower()
        return lower == prefix or lower.startswith(prefix + " ")
    return False


def extract_focus(body: str, reviewer: str) -> str:
    """Return the text after `/<reviewer> review` on the first non-empty line."""
    if not body:
        return ""
    prefix = trigger_prefix(reviewer)
    for raw in body.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.lower() == prefix:
            return ""
        if line.lower().startswith(prefix + " "):
            return line[len(prefix) + 1 :].strip()
        return ""
    return ""


def author_allowed(login: object, allowed: str) -> bool:
    return isinstance(login, str) and login.lower() == allowed.lower()


GITHUB_HTTPS_RE = re.compile(r"^https?://(?:[^@]+@)?github\.com/([^/]+)/([^/]+?)(?:\.git)?$")
GITHUB_SSH_URL_RE = re.compile(r"^ssh://git@github\.com/([^/]+)/([^/]+?)(?:\.git)?$")
GITHUB_SCP_RE = re.compile(r"^git@github\.com:([^/]+)/([^/]+?)(?:\.git)?$")
REPO_SHORTHAND_RE = re.compile(r"^([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?$")


def parse_github_repo(url: str) -> str:
    """Parse `owner/repo` from a github remote URL or `owner/repo` shorthand."""
    text = url.strip().rstrip("/")
    for pattern in (GITHUB_HTTPS_RE, GITHUB_SSH_URL_RE, GITHUB_SCP_RE, REPO_SHORTHAND_RE):
        match = pattern.match(text)
        if match:
            return f"{match.group(1)}/{match.group(2)}"
    raise ValueError(f"cannot parse owner/repo from {url!r}")


def detect_repo_from_origin(repo_dir: str | None) -> str:
    """Resolve `owner/repo` from the `origin` remote of repo_dir (or cwd)."""
    base = ["git", "-C", repo_dir] if repo_dir else ["git"]
    result = subprocess.run(
        [*base, "remote", "get-url", "origin"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        where = f" in {repo_dir}" if repo_dir else ""
        detail = result.stderr.strip() or "not a git repo or no origin remote"
        raise ValueError(f"no --repo given and cannot read git origin{where}: {detail}")
    try:
        return parse_github_repo(result.stdout)
    except ValueError:
        where = f" in {repo_dir}" if repo_dir else ""
        raise ValueError(
            f"origin remote{where} is not a github repo: {result.stdout.strip()!r} "
            f"(pass --repo owner/name to override)"
        ) from None


def resolve_repo(args: argparse.Namespace) -> str:
    if args.repo and args.repo.strip():
        return parse_github_repo(args.repo)
    return detect_repo_from_origin(args.repo_dir)


def detect_author() -> str:
    """Resolve the watcher owner's login from the `gh`-authenticated user."""
    result = subprocess.run(
        ["gh", "api", "user", "--jq", ".login"],
        capture_output=True,
        text=True,
    )
    login = result.stdout.strip()
    if result.returncode != 0 or not login:
        detail = result.stderr.strip() or "is gh authenticated? (gh auth status)"
        raise ValueError(f"no --author given and cannot resolve gh user: {detail}")
    return login


def resolve_author(args: argparse.Namespace) -> str:
    if args.author and args.author.strip():
        return args.author.strip()
    return detect_author()


def repo_slug(repo: str) -> str:
    return repo.replace("/", "__")


def state_path(reviewer: str, repo: str) -> Path:
    return (
        Path.home()
        / ".agents"
        / "plugin-data"
        / f"{reviewer}-review"
        / repo_slug(repo)
        / "seen.json"
    )


def legacy_state_path(reviewer: str) -> Path:
    return Path.home() / ".agents" / "plugin-data" / f"{reviewer}-review" / "seen.json"


def log_path(pid: int, reviewer: str, seen_file: Path) -> Path:
    d = seen_file.parent / "logs"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"watch_{reviewer}_review_{pid}.log"


def load_seen(path: Path) -> tuple[set[int], bool]:
    if not path.exists():
        return set(), False
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return set(), False
    ids = data.get("ids") if isinstance(data, dict) else data
    if not isinstance(ids, list):
        return set(), False
    out: set[int] = set()
    for item in ids:
        if isinstance(item, int):
            out.add(item)
        elif isinstance(item, str) and item.isdigit():
            out.add(int(item))
    return out, True


def save_seen(path: Path, ids: set[int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"ids": sorted(ids)}, indent=2) + "\n")


def gh_graphql(repo: str) -> dict[str, Any]:
    result = subprocess.run(
        [
            "gh",
            "api",
            "graphql",
            "-f",
            f"query={SEARCH_QUERY}",
            "-f",
            f"search=repo:{repo} is:pr is:open",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "gh graphql failed")
    return json.loads(result.stdout)


def collect_triggers(
    payload: dict[str, Any], allowed_author: str, reviewer: str, repo: str
) -> list[dict[str, Any]]:
    search = (payload.get("data") or {}).get("search") or {}
    found: list[dict[str, Any]] = []
    for node in search.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        number = node.get("number")
        pr_url = node.get("url")
        comments = ((node.get("comments") or {}).get("nodes")) or []
        for comment in comments:
            if not isinstance(comment, dict):
                continue
            body = comment.get("body") or ""
            if not is_trigger(body, reviewer):
                continue
            cid = comment.get("databaseId")
            if not isinstance(cid, int):
                continue
            author = (comment.get("author") or {}).get("login")
            if not author_allowed(author, allowed_author):
                continue
            found.append(
                {
                    "kind": f"{reviewer}_review",
                    "reviewer": reviewer,
                    "repo": repo,
                    "pr": number,
                    "comment_id": cid,
                    "url": comment.get("url"),
                    "pr_url": pr_url,
                    "author": author,
                    "created_at": comment.get("createdAt"),
                    "body": body.strip(),
                    "focus": extract_focus(body, reviewer),
                }
            )
    return found


def log(path: Path, message: str) -> None:
    with path.open("a") as handle:
        handle.write(f"{time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())} {message}\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--reviewer",
        default=None,
        help=f"Reviewer name: watches for `/<reviewer> review` (known: {', '.join(KNOWN_REVIEWERS)}). "
        f"May also come from ${REVIEWER_ENV_VAR}.",
    )
    parser.add_argument(
        "--repo",
        default=None,
        help="owner/repo to watch (default: parsed from the origin remote).",
    )
    parser.add_argument(
        "--repo-dir",
        default=None,
        help="Directory to resolve the git origin in (default: cwd).",
    )
    parser.add_argument(
        "--author",
        default=None,
        help="Only this GitHub login can trigger a review (default: gh-authenticated user).",
    )
    parser.add_argument("--poll-interval", type=int, default=30)
    parser.add_argument("--once", action="store_true", help="One poll then exit 0 (no ACTION_REQUIRED on baseline).")
    parser.add_argument("--state-file", default=None, help="Override the seen.json path.")
    return parser.parse_args()


def resolve_reviewer(args: argparse.Namespace) -> str:
    raw = args.reviewer or os.environ.get(REVIEWER_ENV_VAR, "")
    if not raw or not raw.strip():
        raise ValueError(
            f"no reviewer: pass --reviewer <name> or set ${REVIEWER_ENV_VAR} "
            f"(known: {', '.join(KNOWN_REVIEWERS)})"
        )
    return normalize_reviewer(raw)


def poll_once(
    repo: str,
    allowed_author: str,
    reviewer: str,
    seen: set[int],
    had_state: bool,
    log_file: Path,
) -> tuple[set[int], bool, list[dict[str, Any]]]:
    payload = gh_graphql(repo)
    search = (payload.get("data") or {}).get("search") or {}
    issue_count = search.get("issueCount")
    if isinstance(issue_count, int) and issue_count > 50:
        log(log_file, f"truncated: {issue_count} open PRs, scanned first 50")
    triggers = collect_triggers(payload, allowed_author, reviewer, repo)
    new: list[dict[str, Any]] = []
    for item in triggers:
        cid = item["comment_id"]
        if cid in seen:
            continue
        seen.add(cid)
        if had_state:
            new.append(item)
    if not had_state:
        log(log_file, f"baseline {len(seen)} trigger comment(s), silent")
    return seen, True, new


def main() -> int:
    args = parse_args()
    try:
        reviewer = resolve_reviewer(args)
        repo = resolve_repo(args)
        author = resolve_author(args)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    pid = os.getpid()
    if args.state_file:
        seen_file = Path(args.state_file)
        legacy_file = None
    else:
        seen_file = state_path(reviewer, repo)
        legacy_file = legacy_state_path(reviewer)
    log_file = log_path(pid, reviewer, seen_file)
    seen, had_state = load_seen(seen_file)
    if not seen_file.exists() and legacy_file is not None and legacy_file.exists():
        seen, _ = load_seen(legacy_file)
        had_state = True
        log(log_file, f"seeded {len(seen)} id(s) from legacy {legacy_file}")
    log(
        log_file,
        f"start repo={repo} reviewer={reviewer} author={author} "
        f"pid={pid} had_state={had_state} seen={len(seen)}",
    )

    while True:
        try:
            seen, had_state, new = poll_once(
                repo, author, reviewer, seen, had_state, log_file
            )
            save_seen(seen_file, seen)
            for item in new:
                log(log_file, f"emit pr={item.get('pr')} comment_id={item.get('comment_id')}")
                print(f"ACTION_REQUIRED: {json.dumps(item, separators=(',', ':'))}", flush=True)
        except Exception as exc:
            log(log_file, f"poll error: {exc}")
        if args.once:
            return 0
        time.sleep(max(args.poll_interval, 15))


def self_check() -> None:
    for reviewer in KNOWN_REVIEWERS:
        assert is_trigger(f"/{reviewer} review", reviewer)
        assert is_trigger(f"/{reviewer} review focus auth", reviewer)
        assert is_trigger(f"  /{reviewer.capitalize()} Review  \n", reviewer)
        assert not is_trigger(f"please /{reviewer} review this", reviewer)
        assert not is_trigger("looks good", reviewer)
        for other in KNOWN_REVIEWERS:
            if other != reviewer:
                assert not is_trigger(f"/{other} review", reviewer)
    assert not is_trigger("", "muse")
    assert not is_trigger("Review\n/muse review", "muse")
    assert extract_focus("/muse review focus auth", "muse") == "focus auth"
    assert extract_focus("/muse review", "muse") == ""
    assert extract_focus("", "muse") == ""
    assert extract_focus("\n  /codex review  trim me  \n", "codex") == "trim me"
    assert normalize_reviewer("Muse") == "muse"
    try:
        normalize_reviewer("../x")
    except ValueError:
        pass
    else:
        raise AssertionError("normalize_reviewer accepted ../x")
    assert author_allowed("octocat", "octocat")
    assert author_allowed("Octocat", "octocat")
    assert not author_allowed("hubot", "octocat")
    assert not author_allowed(None, "octocat")
    assert parse_github_repo("https://github.com/masumi-network/sokosumi.git") == "masumi-network/sokosumi"
    assert parse_github_repo("https://github.com/mrosberghaus/vanguard") == "mrosberghaus/vanguard"
    assert parse_github_repo("https://user@github.com/mrosberghaus/vanguard.git") == "mrosberghaus/vanguard"
    assert parse_github_repo("git@github.com:mrosberghaus/vanguard.git") == "mrosberghaus/vanguard"
    assert parse_github_repo("ssh://git@github.com/mrosberghaus/vanguard.git") == "mrosberghaus/vanguard"
    assert parse_github_repo("mrosberghaus/vanguard") == "mrosberghaus/vanguard"
    assert parse_github_repo("mrosberghaus/vanguard.git") == "mrosberghaus/vanguard"
    for bad in ("git@gitlab.com:o/r.git", "git@github.com:o", "not a repo", "", "https://github.com/onlyowner"):
        try:
            parse_github_repo(bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"parse_github_repo accepted {bad!r}")
    assert repo_slug("masumi-network/sokosumi") == "masumi-network__sokosumi"
    print("ok")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--self-check":
        self_check()
        raise SystemExit(0)
    raise SystemExit(main())
