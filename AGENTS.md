# AGENTS.md

## What this is
TypeScript library that automates badminton court sign-ups at Bellevue
Badminton Club by driving app.courtreserve.com with Playwright. Public
entrypoint is `src/index.ts` (re-exports `CourtReserveClient` from
`src/client.ts`). Plain TypeScript, CommonJS build, no framework, no lint,
no CI.

## Commands
- `npm run build` — runs `tsc`; outputs to `dist/`. Only typechecks `src/**`
  (tsconfig rootDir `src`) — it does NOT typecheck `test/`.
- `npx vitest run` — full test suite. Config in `vitest.config.ts`: globals
  on, node env, include `test/**/*.test.ts` only.
- `npx vitest run test/utils.test.ts` (or add `-t "<test name>"` for one test).
- `npm start` / `npx tsx examples/usage.ts` — launches a real Chromium and
  talks to the live site; requires a saved session. Never run in CI/automation.
- `npm run playwright:install` — installs the Chromium binary; required once
  before any browser run.

## Never read or commit these (gitignored local state)
- `auth.json` — real logged-in Playwright storage state (live session cookies).
- `my-profile/` — persistent Chromium profile directory.
- `package-lock.json` — gitignored but exists locally; deps can drift.

## Gotchas
- `headless` actually defaults to TRUE in `src/constants.ts` (`process.env.HEADLESS !== "false"`),
  contradicting the README's "default false" table; `examples/usage.ts` forces it false.
- `pauseForAction()` inserts random 400–2000ms delays between browser actions
  (`MIN_ACTION_DELAY_MS` / `MAX_ACTION_DELAY_MS` env vars) — deliberate anti-bot
  pacing. Use fake timers in unit tests; never assert real timing.
- `CourtReserveClient.addPlayerToBooking` / `removePlayerFromBooking` are
  unimplemented stubs that throw (`src/client.ts`).
- All scraping depends on CourtReserve `data-testid` attributes and dayjs
  parsing (`src/booking.ts`); if the site markup changes, parsing breaks.

## Testing
- Unit tests (no browser): `test/*.test.ts`, import from `../src/index`.
- Functional tests (real Chromium): `test/functional/booking.test.ts`, loads
  HTML fixtures from `test/data/` into Playwright and exercises the
  Playwright-dependent scraping functions (`getBookingsFound`,
  `collectBookingSessions`, `editBooking`). Requires `npm run playwright:install`
  first.
- `test/data/*.html` are pruned snapshots of the live CourtReserve booking page,
  used as fixtures by functional tests. They were captured as MHTML, then cut
  down to the `[data-testid="booking-tabs"]` subtree (the only part the scrapers
  read) inside a minimal HTML shell — no CSS, images, or scripts. That took them
  from ~4.8MB each to ~2-6KB. The markup inside the div is byte-for-byte as the
  site served it.
- Because the CSS is gone, the fixtures have no realistic layout. Assertions on
  geometry (`boundingBox()`, scrolling, hover targets — i.e. `editBooking`) will
  not reflect production; only DOM structure and text are faithful.
- `test/functional/setup.ts` provides `loadFixture()` — reads the file and sets
  it as page content.
- `npm run test:coverage` is configured (v8 provider) but `@vitest/coverage-v8`
  is not installed, so it will error until that package is added.
