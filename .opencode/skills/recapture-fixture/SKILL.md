---
name: recapture-fixture
description: Re-cut a test/data HTML fixture from a live CourtReserve page — produce an MHTML capture, slice it with test/data/recapture.ts, trim it to what the tests assert, scrub real member names, and verify it under vitest. Use when CourtReserve markup changes and the functional-test fixtures no longer parse, or when adding a fixture for a new flow. The existing /recapture command is the short version of this procedure.
---

# Recutting a fixture

The functional tests (`test/functional/`) drive real Chromium against pruned HTML
fixtures in `test/data/`. When the site changes, those fixtures stop matching and
the tests fail for markup reasons, not code reasons. This is how to replace one.

Division of labour: `test/data/recapture.ts` does exactly one thing — decode the
capture, slice a subtree, wrap it in a shell. Everything around that is here.
`/recapture` is the one-screen version; this file is the version that explains
why.

## 0. Get a capture (usually the hard part)

A capture is what Chromium's **Save page as… → MHTML** writes: a multipart MIME
message, several MB, `text/html` part quoted-printable, every stylesheet and
image inlined as a `cid:` reference.

- Check what's already here first: `find test/data -name '*.mhtml'`. As of
  2026-10-20 only `login-page.mhtml` and `not-logged-in.mhtml` remain (both from
  Aug 31) — **and neither is a bookings list**, so recapturing a bookings fixture
  means capturing the page again live.
- To capture: log into CourtReserve in a real Chromium. The `examples/*` force
  `headless: false`, and the bot takes `--headed`; both get you a logged-in window
  you can save from.
- Scriptable alternative: CDP `Page.captureSnapshot({format: "mhtml"})` over
  `context.newCDPSession(page)`. Nothing committed does this yet — if you write it
  it belongs next to `recapture.ts`.
- `page.content()` is **not** a substitute: the script needs the multipart wrapper
  and its quoted-printable part; `page.content()` is already-decoded DOM HTML.

Captures are gitignored (`.gitignore`: `test/data/**/*.mhtml`) and several MB
each. **Never commit one** — only the pruned `.html`.

## 1. Slice

```
npx tsx test/data/recapture.ts <capture.mhtml> [anchor] [out.html] [tag]
```

- `anchor` — a literal substring matched anywhere, so any attribute fragment
  works. Default `data-testid="booking-tabs"`.
- `tag` — element to slice; defaults to the nearest enclosing open tag before the
  anchor, which is why `<table>` and untagged `<header>` anchors still work. Pass
  it explicitly when the default would grab too little.
- `out.html` — omit to print to stdout.

Anchors that match the committed fixtures (read their first lines to confirm):

| What you want | anchor | tag | example fixtures |
|---|---|---|---|
| bookings list | `data-testid="booking-tabs"` | *(auto: `div`)* | `one-booking-two-people.html`, `no-booking.html`, `booking-by-other-people.html`, `adding-player/two-bookings.html` |
| edit-modal member table | `data-testid="member-table"` | `table` | `adding-player/edit-modal.html`, `adding-player/player-added.html`, `removing-player/modal-player-list.html`, `removing-player/modal-player-removed.html` |
| the Edit Reservation link | `UpdateMyReservation` | `a` | `adding-player/player-options.html`, `adding-player/reservation-detail.html` |
| portal header (logged out) | `class="header-nav` | *(auto: `header`)* | `not-logged-in.html` |
| login form | `class="form-horizontal"` | `form` | `login-page.html` |

The last two rows need no direction: `<header>` carries no testid and the login
page's `<form>` has no anchor-friendly attribute beyond its class.

If the script exits `anchor not found`, the testid itself moved — that is a `src/`
parsing bug to report, not a fixture problem.

## 2. Trim (seriously — this is step three, not optional)

Write to `/tmp` first and diff against the fixture you're replacing. The output is
a *containing subtree*; committed fixtures are hand-pruned subsets of it, not
byte-exact output (`not-logged-in.html` keeps 6.5 KB of `<header>` where the
script yields 17.5 KB). So a diff is context, not a correctness check.

Trim to what the tests actually read:

- `getBookingsFound` reads `page.getByText("Booking Found")`, whose source is
  `data-testid="booking-count"` — and that element sits **inside** `booking-tabs`
  (under `booking-list-active`), which is why `one-booking-two-people.html`
  satisfies it (`test/functional/booking.test.ts:23`). Anchoring on
  `booking-tabs` keeps it; don't delete it while trimming.
- `collectBookingSessions` needs the card wrappers
  (`data-testid="booking-card*"`); `no-booking.html` needs `data-testid="no-bookings"`.
- Drop everything else — script/style tags are already gone, so what's left to
  cut is mostly wrapper chrome.

## 3. Scrub before committing

Fixtures are tracked files. A live capture contains **real member names**;
replace them. The house style is famous badminton players rather than invented
strings — the existing fixtures use `Lin Dan`, `Viktor Axelsen`, `Anthony
Ginting`, so match that. The same cleanup was done once already for
`bot/test/data/Sept-2026.csv`.

Numbers that are not personal (`reservationId=58800347`,
`booking-card-wrapper-58`) are fine as-is and are what the existing fixtures do.

## 4. Verify

```
npx vitest run test/functional/<file>     # needs Chromium: npm run playwright:install
```

The failure mode to watch for is a fixture that loads but parses to **zero**
bookings — the selectors resolve, nothing is extracted, and the test only fails
if it asserts a count. Assert counts, not selectors, and run the whole file, not
just the one test: several fixtures are read by more than one case.

## 5. Close the loop

Update the fixture list in `test/data/README` when you add or rename a fixture,
and say so in the commit. If you had to change anything in `src/` to make the new
markup parse, that is the real bug — call it out separately from the fixture work.
