---
description: Turn a fresh full-page .mhtml capture into a pruned test/data fixture
agent: build
---

Re-cut a test fixture from a live CourtReserve capture, for when the site markup changes and the existing `.html` fixtures no longer match.

This is the short version. **The full procedure is the `recapture-fixture` skill** — producing a capture, choosing an anchor per fixture, what to trim, and how to scrub real member names. Load it when anything here is unclear or when adding a fixture for a new flow.

A capture is what the browser's **Save page as… → MHTML** produces: a multipart MIME message, several MB, `text/html` part quoted-printable encoded, every stylesheet and image inlined as a `cid:` reference. The procedure is scripted, so do not hand-roll it:

```
npx tsx test/data/recapture.ts <capture.mhtml> [anchor] [out.html] [tag]
```

- `anchor` — a literal substring of the element to keep. Defaults to `data-testid="booking-tabs"` (the bookings list). Any attribute fragment works: `data-testid="member-table"` (the modal's player table), `class="header-nav` (the portal header used by the not-logged-in fixture).
- `tag` — the element to slice. Defaults to the nearest enclosing open tag before the anchor, which is why an anchor on a `<table>` or on an untagged `<header>` still slices correctly.
- `out.html` — omit to print to stdout.

Steps:

1. Find the capture: `find test/data -name '*.mhtml' -newer <the fixture you are replacing>`. Captures are gitignored (`.gitignore`: `test/data/**/*.mhtml`) and several MB each — **never commit one**.
2. Generate a candidate next to nothing yet: write to `/tmp` first, diff it against the existing fixture, and only then overwrite the fixture.
3. **Trim to what the test asserts.** The script's output is the containing subtree, and the committed fixtures are hand-pruned subsets of it, not byte-exact output — `not-logged-in.html` keeps a 6.5 KB `<header>` where the script yields 17.5 KB. Drop the wrappers a fixture does not need, but keep what a test reads: `data-testid="booking-count"` ("N Booking Found") lives **inside** `booking-tabs`, which is why `one-booking-two-people.html` satisfies `getBookingsFound` (`test/functional/booking.test.ts:23`). An earlier revision of this file claimed that count sat outside `booking-tabs`; it does not.
4. **Check for real names before committing.** Fixtures are tracked, and a live capture contains real member names. Replace them with obvious placeholders — the repo has already had to do this once for `bot/test/data/Sept-2026.csv`.
5. Verify: `npx vitest run test/functional/<file>` (needs Chromium — `npm run playwright:install` once per machine). A fixture that loads but parses to zero bookings is the failure mode to watch for, so assert the booking count, not just the selector.

If the site markup changed such that no anchor matches, the script exits 1 with `anchor not found` — that means the testid itself moved, which is a `src/` parsing bug to report, not a fixture problem.
