# CLAUDE.md

Context for AI agents working in this repo. Keep this file in sync if the
architecture changes.

## Brand

The store brand is **GildedLayer**. Logo lives at `assets/img/logo.jpg`
(warm-gold wordmark on a cream background, with a classical bust silhouette).
The visual identity is "premium store, dark gallery": near-black warm
background, gold accent (`#c79f3d`), serif headlines (Cormorant Garamond),
sans body (Inter), tight uppercase letter-spacing on CTAs and section labels.
Sculptor chips intentionally use a cool steel-blue tone — that color distinction
between tag chips (gold) and sculptor chips (steel) is **load-bearing UX**, not
decorative. Don't unify them.

## Language

The customer-facing UI is **Spanish (es-AR)** — `<html lang="es">`. All UI
strings (header tagline, filter labels, button text, lightbox, contact,
footer) are in Spanish. **Tag IDs and card titles are NOT translated** — they
come from the source (Gumroad creator titles in English), and translating
them would either require a manual mapping table or AI translation per model,
both of which the owner declined. So the contract is:
- UI chrome: Spanish.
- Data (titles, tag slugs, sculptor names): as-fetched.

If you ever switch languages or add a second locale, only the strings in
`index.html` and the literal strings in `app.js` (loading message, empty
state, `'Sin título'` fallback, `setTagExpanded()` toggle labels) need
updating.

## What this is

A static, GitHub Pages-hosted portfolio for a commission-based business: the
owner hand-paints 3D prints of characters (anime, videogames, movies, series,
books). The site advertises sculpts the owner can print, sourced from the
original digital sculptors — not the owner's own work.

The owner does not maintain content manually. They edit one YAML file listing
creators; a daily GitHub Action scrapes/fetches metadata and writes a JSON
catalog the site reads.

## Architecture

```
data/creators.yaml   → owner-edited list of sculptors + per-creator config
       │
scripts/fetch.mjs    → Node script, runs daily on Actions
       │
data/models.json     → generated catalog (DO NOT edit by hand)
       │
index.html + app.js  → vanilla JS site (no framework, no build step)
       │
GitHub Pages         → public hosting
```

No framework, no bundler, no build. The site is pure HTML/CSS/ES modules and is
served as-is from the repo root.

## File layout

- `index.html` — single-page gallery. Contact email/Instagram are hardcoded
  placeholders (`CHANGE_ME`) the owner must edit.
- `assets/css/styles.css` — dark theme, CSS columns for masonry, lightbox.
- `assets/js/app.js` — fetches `data/models.json`, builds filter chips
  (featured/tag/creator), renders cards, handles lightbox.
- `data/creators.yaml` — the only file the owner edits. Schema is documented
  in-file. `platform` field selects which adapter runs.
- `data/models.json` — generated. Schema: `{ generated_at, new_count, count, errors, models[] }`.
  Each model: `{ id, slug, title, creator, image, source_url, description, tags[], featured, first_seen }`.
  `first_seen` is an ISO timestamp set the first time the model appears in a
  catalog refresh; subsequent runs preserve it. Powers the "Nuevas" tab.
- `scripts/fetch.mjs` — adapter-per-platform fetcher. Exits 0 even if individual
  creators fail; errors are recorded in `models.json.errors`.
- `.github/workflows/refresh.yml` — daily cron + manual dispatch. Commits
  `models.json` only when it changes.
- `.github/workflows/deploy.yml` — Pages deploy on push to `main`.

## Supported platforms (in `creators.yaml`)

| platform        | mechanism                              | stability                       |
|-----------------|----------------------------------------|---------------------------------|
| `myminifactory` | public API                             | stable                          |
| `artstation`    | public projects JSON                   | stable                          |
| `gumroad`       | parses Inertia.js `data-page` payload  | stable as long as Gumroad ships Inertia |
| `payhip`        | HTML scrape                            | fragile — selectors drift       |
| `cults`         | HTML scrape, paginated via `?page=N`   | stable; cards use `a.tbox-thumb`. **Images proxied via wsrv.nl in `app.js` (`proxyImageUrl`)** because `images.cults3d.com` returns HTTP/2 PROTOCOL_ERROR when the browser opens many parallel streams — not a Referer block, server-side bug. |
| `tribes`        | HTML scrape                            | fragile — best-effort           |
| `generic`       | OpenGraph fallback                     | works for any site with og:* tags; pulls only ONE item (the URL itself) |

Gumroad shop pages are server-rendered Inertia.js apps. The HTML embeds only
the first page (~9-18 items) of each section in `<div id="app" data-page=...>`.
To get the full catalog, the adapter paginates via the search endpoint:

```
GET https://gumroad.com/products/search
  ?user_id={creator_profile.external_id}
  &section_id={section.id}        # both required to scope to seller
  &from={offset}&size={per_page}
```

Confirmed via `app/controllers/links_controller.rb#search` in antiwork/gumroad.
Without `section_id`, the endpoint returns the global discover feed. Section
IDs are base64-looking strings like `_CJpN9YOOI5-Abt_Et_0pA==`. Dedupe by
`permalink` across sections — the same product appears in multiple sections
("Pinned", "Top", etc).

Per-creator request volume scales with catalog size (50 per page) — be polite
with delays (250ms between requests, already in the adapter). 1500 models =
~40s fetch time which is fine for a daily cron.

When the Inertia-based Gumroad parser breaks, the fix is to fetch a shop page
manually, look at `#app[data-page]` JSON, and adjust the path. When a
selector-based scraper (Payhip, Tribes) breaks, open the live page in devtools
and update the cheerio query. Patreon is intentionally not supported (auth
required, ToS restrictive).

**HTTP headers must be ASCII.** The `UA` constant at the top of `fetch.mjs`
must not contain em-dashes or other non-ByteString chars or Node's `fetch`
throws.

## Title exclusions (filtering)

After dedupe, `fetch.mjs` drops any model whose title matches `EXCLUDE_PATTERNS`
or is detected as a standalone prop (a `PROP_KEYWORDS` hit with no
`SCULPTURE_MARKERS` word). This removes:

- life-size props (`\blife.?size\b`)
- mass bundles (`welcome pack`, `halloween pack`, `swag pack`, `promo pack`,
  `father's day pack`, `all collection`, `black friday`)
- oversized scale props (`\bN:1 scale\b`)
- standalone weapons (sword/blaster/hammer/etc.) with no character sculpt marker

`PROP_KEYWORDS` deliberately omits `mask`, `helmet`, `shield` — those words
frequently refer to characters ("The Mask", "Black Mask", a "Captain America
shield bust"). Keep that constraint when extending the list.

The output JSON includes `excluded_count` so you can verify the filter ran.
When a user complains "this product is missing", first check whether it was
excluded — `git log` the file or temporarily add `console.log(dropped)` in
`main()`.

## Display title cleaning

`app.js` has a `cleanTitle()` function and a `CLEAN_RULES` table that strips
Gumroad marketing boilerplate (creator prefixes like "Wicked Marvel",
"B3DSERK", "ZCF"; term/date markers like "April Term 2022" or "April 2026
Term"; format tags like "3D PRINT", "STL"; "ready for printing" / "Tested and
ready for printing"; scale notations like "1/4" or "1:1 scale"). It also
title-cases ALL-CAPS titles ("MICKEY MOUSE" → "Mickey Mouse") and keeps the
type word ("Bust", "Sculpture", "Portrait Bust", "Diorama").

Cleaning runs **at render time, not at fetch time** — the raw title is kept
in `models.json` so a rule change doesn't require a re-fetch (~40s). Search
hits the raw title, so even searching for boilerplate words still works.

When a user reports a title that looks wrong, add it to the `samples` array
in a one-off `_scratch_test_clean.mjs` test file, iterate the rules, delete
the file when done. Don't commit scratch files.

## Lightbox

The "View original" link out to Gumroad was intentionally removed — the
owner doesn't want to drive customers to Gumroad. Only "Commission this →"
remains. Don't re-add the source link without explicit ask, even though
`source_url` is still in `models.json`.

## "Nuevas esta semana" tab

The default landing filter is `✨ Nuevas`, which shows models whose
`first_seen` is within the last 7 days (`NEW_WINDOW_MS` in `app.js`).
`first_seen` is stamped server-side in `scripts/fetch.mjs`: before writing
the new catalog, the fetcher reads the previous `models.json`, carries over
`first_seen` for every id it recognises, and stamps `nowIso` on truly new
ids. Legacy models (in the catalog before this field existed) get
`LEGACY_SENTINEL` (`2020-01-01T00:00:00.000Z`) as their `first_seen` — well
outside the 7-day window — so the first run after migration doesn't dump
the entire backlog into the "Nuevas" tab. Don't fall back to `prev.generated_at`
for this; the prev run is usually within the 7-day window so you'd get the
exact bug the sentinel is there to prevent.

The chip displays a live count (`✨ Nuevas (N)`). If `N === 0`, `load()`
silently falls back to `'all'` so the default view is never empty. Don't
add a "no new this week" empty state — the fallback handles it.

Caveat: an `id` is `slugify(creator)--slugify(title)`. A title rename
creates a new id and the model will appear as "new" for a week. Acceptable.

## Filter UI structure

The filter bar has three visually distinct zones (since 2026-05):

1. **Quick row** — `✨ Nuevas` / `Todas` / `★ Destacadas` quick chips + the main model search.
2. **Tags section** — `Tags` label + tag-search input + chips with
   `#tag-name (count)`. Orange/accent color scheme. Class:
   `.filter-group-tags`. Only one tag active at a time; "Clear tag" link
   appears when one is selected.
   **Collapsed by default to ~2 rows** because 130+ chips would dominate the
   home page. A "Show all" / "Show less" toggle expands. Typing in the
   tag-search input also auto-expands so matches aren't cut off. Implemented
   via `#tag-section.is-expanded` toggling on `.filter-group-tags` max-height.
3. **Sculptors section** — `Sculptors` label + creator chips with `(count)`.
   Teal/blue color scheme to visually distinguish from tags. Class:
   `.filter-group-creators`. Only one sculptor active at a time.

When a user complains "I can't find the X tag", remember the tag-search input
exists — it does substring filtering on chip text. Tags are sorted by usage
count descending so the most common ones surface first.

The `.chip-count` element shows the model count per filter. Use the chip
counts (not raw `state.models.length`) to discuss tag prevalence with the
user.

## Lazy rendering

`app.js` renders cards in batches of `PAGE_SIZE` (60). After the initial
batch, an `IntersectionObserver` watches a `.scroll-sentinel` at the bottom
of the gallery and triggers `renderNextBatch()` ~600px before it enters the
viewport. On any filter or search change, the cache + counter reset and
rendering restarts from the top.

The sentinel must have `column-span: all` in CSS — without it, CSS columns
place the sentinel mid-column and the observer fires at the wrong time.

## Auto-tagging

`scripts/fetch.mjs` ships a `KEYWORD_TAGS` table that derives per-model tags
from the title (and description, when present). Matching uses **word-boundary
regex**, not substring — substring matching causes false positives on short
keywords (e.g. `ken` matching "Kennedy"). Always keep this constraint.

Tags from three sources are merged onto each model:
1. Auto-tags inferred from the title via `KEYWORD_TAGS`
2. Creator-level tags from `creators.yaml` (`tags: [foo]` applies to all
   models from that creator — use for creators with a clear single theme,
   e.g. a cartoon-only shop)
3. Adapter-supplied tags (e.g. MyMiniFactory exposes user-tagged categories)

When the user complains a model has wrong tags or no tags:
- Wrong tag → check the keyword list for an overly broad match; tighten or
  remove that keyword. Don't add narrower keywords that overlap broader ones.
- Missing tag → add a precise keyword to the relevant category in
  `KEYWORD_TAGS`. Prefer multi-word keywords ("dr. fate") over short ones.

**Pitfall — never `replace_all` the literal `\b` (backslash-b) string across
`fetch.mjs`.** The word-boundary wrapper around the compiled regex
(`'\b(?:...|...)\b'`) contains the same sequence as inline escapes that may
appear inside keyword strings. A global replace strips the wrapper's word
boundaries too, and every short keyword (`vi`, `ryu`, `link`) starts matching
as a substring — `vi` will match "Movies" and cross-tag dozens of unrelated
items. Symptom: tag counts explode and franchises bleed into each other.
Always edit keyword strings individually.

## Conventions

- Vanilla JS, no dependencies in the browser. Don't introduce a framework.
- Fetcher dependencies are minimal (`cheerio`, `yaml`). Don't add more without
  a real reason.
- All adapters return arrays of models built via `makeModel()` to guarantee
  consistent shape. New platforms should follow the same pattern.
- `id` is `slugify(creator)--slugify(title)` — stable across runs as long as
  title doesn't change.
- Featured flag is applied by matching `featured: [...]` slugs from
  `creators.yaml` against each model's slug or title slug.
- Errors per-creator are caught and recorded; the run never fails because one
  source is down.
- No PII, no tracking, no cookies. Keep it that way.

## Things to watch out for

- **Legal gray area.** The renders are © the original sculptors. The footer
  credits them and every card links back via `source_url`. Don't remove those.
  If the owner asks to host images locally (mirror them into the repo), push
  back — that escalates the rights problem.
- **GitHub Actions needs write permission** to commit refreshed catalogs.
  Documented in README. If commits stop appearing, that setting is the first
  thing to check.
- **`models.json` is committed** so the site works without running the fetcher
  on every page load. Don't switch to runtime fetching from the browser — most
  source sites block CORS.
- **Daily cron is at 06:17 UTC.** Spread out if you add more workflows so
  they don't all hit at once.
- **Don't introduce a build step.** GitHub Pages serves the repo verbatim;
  adding a bundler means adding another workflow stage. Resist.

## Common tasks

- Add a new creator: append to `data/creators.yaml`, push. Manually trigger
  "Refresh catalog" in Actions to see results immediately (otherwise wait for
  the next cron).
- Add a new platform adapter: add an entry to `adapters` in `scripts/fetch.mjs`
  returning `makeModel()`-shaped objects. Document it in the README table and
  the YAML comment header.
- Fix a broken scraper: load the creator's page, find the new selectors with
  devtools, update the cheerio queries.
- Style tweaks: `assets/css/styles.css`. Variables live at the top under
  `:root`.

## What NOT to do

- Don't add a JS framework, bundler, or TypeScript. Lightweight is a feature.
- Don't add server-side anything. GitHub Pages is static-only.
- Don't mirror creator images into the repo. Hotlink via `source_url`-adjacent
  CDNs.
- Don't edit `data/models.json` by hand — the next refresh wipes it.
- Don't remove the per-creator credit/link-back in the lightbox.
- Don't add analytics or third-party trackers without explicit ask.

## Owner profile

Runs a commission-only business (no inventory). Prioritizes low maintenance
overhead. Uses Windows + PowerShell. Not necessarily a developer — keep
suggestions concrete and avoid jargon unless they signal otherwise.
