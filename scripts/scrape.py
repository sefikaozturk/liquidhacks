#!/usr/bin/env python3
"""
Devpost hackathon winner scraper
Outputs hackathon_winners.json in the format expected by /api/admin/growth

Usage:
    pip install requests beautifulsoup4
    python scripts/scrape.py                        # auto-discover recent hackathons
    python scripts/scrape.py --hackathons utra-hacks globalhack   # specific slugs
    python scripts/scrape.py --pages 5              # how many pages of hackathons to discover
    python scripts/scrape.py --resume               # skip already-scraped projects
    python scripts/scrape.py --winners-only         # skip projects with no prizes (default: True)
"""

import json
import os
import re
import sys
import time
import argparse
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

OUTPUT_FILE = Path(__file__).parent.parent / "hackathon_winners.json"
RATE_LIMIT_DELAY = 1.0  # seconds between requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}

session = requests.Session()
session.headers.update(HEADERS)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get(url: str, retries: int = 3, **kwargs) -> requests.Response | None:
    for attempt in range(retries):
        try:
            r = session.get(url, timeout=20, **kwargs)
            if r.status_code == 429:
                wait = int(r.headers.get("Retry-After", 30))
                print(f"  Rate limited — waiting {wait}s", flush=True)
                time.sleep(wait)
                continue
            if r.status_code == 404:
                return None
            r.raise_for_status()
            time.sleep(RATE_LIMIT_DELAY)
            return r
        except requests.RequestException as e:
            if attempt < retries - 1:
                time.sleep(3 * (attempt + 1))
            else:
                print(f"  Error fetching {url}: {e}", flush=True)
    return None


def soup(r: requests.Response) -> BeautifulSoup:
    return BeautifulSoup(r.text, "html.parser")


def clean(text: str | None) -> str:
    if not text:
        return ""
    return " ".join(text.strip().split())


# ---------------------------------------------------------------------------
# Devpost API: discover hackathons
# ---------------------------------------------------------------------------

def discover_hackathons(pages: int = 3) -> list[dict]:
    """
    Uses the Devpost public API to list recently-ended hackathons.
    Returns list of {slug, title, url}
    """
    hackathons = []
    for page in range(1, pages + 1):
        r = get(
            "https://devpost.com/api/hackathons",
            params={
                "challenge_type": "all",
                "order_by": "recently-added",
                "status": "ended",
                "page": page,
            },
        )
        if not r:
            break
        data = r.json()
        items = data.get("hackathons", [])
        if not items:
            break
        for h in items:
            url: str = h.get("url", "")
            slug = urlparse(url).hostname.split(".")[0] if url else ""
            hackathons.append({
                "slug": slug,
                "title": h.get("title", slug),
                "url": url,
            })
        print(f"  Discovered {len(hackathons)} hackathons so far (page {page})…", flush=True)

    return hackathons


# ---------------------------------------------------------------------------
# Scrape project gallery for a hackathon
# ---------------------------------------------------------------------------

def scrape_project_gallery(slug: str, winners_only: bool = True) -> list[dict]:
    """
    Returns list of {url, title, tagline, prizes, hackathon} for all projects in a hackathon.
    Tries JSON endpoint first; falls back to HTML.
    """
    base = f"https://{slug}.devpost.com"
    projects = []
    page = 1

    while True:
        # Try JSON gallery endpoint (undocumented but stable)
        r = get(
            f"{base}/project-gallery.json",
            params={"page": page, "per_page": 24},
        )

        if r and r.headers.get("content-type", "").startswith("application/json"):
            data = r.json()
            items = data.get("software", [])
            if not items:
                break
            for item in items:
                prizes = [a.get("title", "") for a in item.get("prize_data", {}).get("prizes", [])]
                if winners_only and not prizes:
                    continue
                projects.append({
                    "url": item.get("url", ""),
                    "title": item.get("title", ""),
                    "tagline": item.get("tagline", ""),
                    "prizes": prizes,
                    "hackathon": "",  # filled in by caller
                })
        else:
            # HTML fallback — scrape the gallery page
            r2 = get(f"{base}/submissions", params={"page": page})
            if not r2:
                break
            s = soup(r2)
            cards = s.select("ul#submissions-gallery li.software-item, div.software-entry")
            if not cards:
                break
            for card in cards:
                link = card.select_one("a.block-wrapper-link, h5 a")
                if not link:
                    continue
                href = link.get("href", "")
                if not href.startswith("http"):
                    href = urljoin(base, href)
                prizes_el = card.select(".prizes li, .prize-badge")
                prizes = [clean(p.get_text()) for p in prizes_el]
                if winners_only and not prizes:
                    continue
                projects.append({
                    "url": href,
                    "title": clean(link.get_text()),
                    "tagline": "",
                    "prizes": prizes,
                    "hackathon": "",
                })

        page += 1
        # Most hackathons fit in <10 pages; cap to avoid runaway
        if page > 50:
            break

    return projects


# ---------------------------------------------------------------------------
# Scrape a project page
# ---------------------------------------------------------------------------

def scrape_project(url: str) -> dict:
    """
    Returns {title, tagline, prizes, links, team_member_urls}
    """
    r = get(url)
    if not r:
        return {}

    s = soup(r)

    title_el = s.select_one("h1#app-title") or s.select_one("h1.title") or s.select_one("h1")
    title = clean(title_el.get_text()) if title_el else ""

    tagline_el = s.select_one("p.tagline, p#app-details-left p:first-child")
    tagline = clean(tagline_el.get_text()) if tagline_el else ""

    # Prizes
    prizes = []
    for el in s.select(".prizes li span, .no-overflow.prizes a, .app-prizes li"):
        t = clean(el.get_text())
        if t:
            prizes.append(t)

    # External links (GitHub, demo, etc.)
    links: dict[str, str] = {}
    for a in s.select("#app-links a, .app-links a, a[href*='github.com']"):
        href = a.get("href", "")
        if "github.com" in href:
            links["github"] = href
        elif href:
            links.setdefault("demo", href)

    # Team member Devpost profile URLs
    member_urls: list[str] = []
    for a in s.select("ul#app-team li a[href*='devpost.com'], #team-members a[href*='devpost.com']"):
        href = a.get("href", "")
        if href and "/software/" not in href:
            member_urls.append(href)

    return {
        "title": title,
        "tagline": tagline,
        "prizes": prizes,
        "links": links,
        "member_urls": list(dict.fromkeys(member_urls)),  # dedupe, preserve order
    }


# ---------------------------------------------------------------------------
# Scrape a Devpost profile
# ---------------------------------------------------------------------------

def scrape_profile(profile_url: str) -> dict:
    """
    Returns {name, bio, github, linkedin, twitter, email, location}
    """
    r = get(profile_url)
    if not r:
        return {"devpost_profile": profile_url, "devpost_url": profile_url, "name": ""}

    s = soup(r)

    name_el = s.select_one("h1.profile-name, h1[itemprop='name'], h1.name")
    name = clean(name_el.get_text()) if name_el else ""

    bio_el = s.select_one("p.short-description, p.bio, div.user-bio p")
    bio = clean(bio_el.get_text()) if bio_el else ""

    location_el = s.select_one("span.location, li.location span")
    location = clean(location_el.get_text()) if location_el else ""

    # Social links
    github = linkedin = twitter = email = ""
    for a in s.select("ul.portfolio-links a, .social-links a, a[href]"):
        href: str = a.get("href", "")
        if not href:
            continue
        if "github.com/" in href and not github:
            github = href.rstrip("/")
        elif "linkedin.com/in/" in href and not linkedin:
            linkedin = href.rstrip("/")
        elif "twitter.com/" in href or "x.com/" in href:
            if not twitter:
                twitter = href.rstrip("/")
        elif href.startswith("mailto:") and not email:
            email = href.replace("mailto:", "").strip()

    # Sometimes email is displayed as plain text with obfuscation
    if not email:
        page_text = s.get_text(" ")
        m = re.search(r"[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}", page_text)
        if m:
            candidate = m.group(0)
            # Skip Devpost's own domain
            if "devpost" not in candidate:
                email = candidate

    return {
        "name": name,
        "devpost_profile": profile_url,
        "devpost_url": profile_url,
        "bio": bio,
        "github": github,
        "linkedin": linkedin,
        "twitter": twitter,
        "email": email,
        "location": location,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def load_existing() -> list[dict]:
    if OUTPUT_FILE.exists():
        try:
            return json.loads(OUTPUT_FILE.read_text())
        except Exception:
            pass
    return []


def save(projects: list[dict]) -> None:
    OUTPUT_FILE.write_text(json.dumps(projects, indent=2, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape Devpost hackathon winners")
    parser.add_argument("--hackathons", nargs="*", metavar="SLUG",
                        help="Hackathon subdomain slugs (e.g. utra-hacks globalhack)")
    parser.add_argument("--pages", type=int, default=3,
                        help="Pages of hackathon discovery to run (default: 3)")
    parser.add_argument("--resume", action="store_true",
                        help="Skip project URLs already in hackathon_winners.json")
    parser.add_argument("--all", dest="winners_only", action="store_false", default=True,
                        help="Include non-winning projects (default: winners only)")
    args = parser.parse_args()

    existing = load_existing()
    existing_urls = {p["url"] for p in existing}
    results = list(existing)

    # Determine hackathons to scrape
    if args.hackathons:
        hackathons = [{"slug": s, "title": s, "url": f"https://{s}.devpost.com"} for s in args.hackathons]
    else:
        print("Discovering hackathons via Devpost API…")
        hackathons = discover_hackathons(pages=args.pages)
        print(f"Found {len(hackathons)} hackathons\n")

    total_new = 0
    for h_idx, h in enumerate(hackathons):
        slug = h["slug"]
        if not slug:
            continue
        print(f"[{h_idx+1}/{len(hackathons)}] {h['title']} ({slug})")

        # Get project list for this hackathon
        projects_meta = scrape_project_gallery(slug, winners_only=args.winners_only)
        if not projects_meta:
            print("  No winning projects found — skipping")
            continue

        new_count = 0
        for p_idx, meta in enumerate(projects_meta):
            url = meta["url"]
            if not url:
                continue
            if args.resume and url in existing_urls:
                continue

            print(f"  [{p_idx+1}/{len(projects_meta)}] {meta['title'] or url}", end=" ", flush=True)

            project = scrape_project(url)
            if not project:
                print("✗")
                continue

            member_urls = project.pop("member_urls", [])
            team_members: list[dict] = []
            for m_url in member_urls:
                member = scrape_profile(m_url)
                if member.get("name"):
                    team_members.append(member)

            entry = {
                "url": url,
                "title": project.get("title") or meta["title"],
                "tagline": project.get("tagline") or meta["tagline"],
                "prizes": project.get("prizes") or meta["prizes"],
                "links": project.get("links", {}),
                "hackathon": h["title"],
                "team_members": team_members,
            }

            results.append(entry)
            existing_urls.add(url)
            new_count += 1
            total_new += 1
            print(f"✓ ({len(team_members)} members)")

            # Save incrementally every 10 projects so we don't lose progress
            if new_count % 10 == 0:
                save(results)

        save(results)
        print(f"  → {new_count} new projects added for {h['title']}\n")

    save(results)
    print(f"\nDone. {total_new} new projects added. Total in file: {len(results)}")
    print(f"Output: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
