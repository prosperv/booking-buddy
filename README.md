# Booking Buddy

This project automates court sign-ups for the Bellevue Badminton Club.

## Setup

1. Make sure Node.js 20 or newer and npm are installed.
2. Install the project dependencies:
   `npm install`
3. Install the Playwright browser binary required for browser automation:
   `npm run playwright:install`

## Build

Build the TypeScript project with:

`npm run build`

After building, the library is at `dist/index.js`.

## Usage as a library

```typescript
import { CourtReserveClient } from "court-sign-up";

const client = new CourtReserveClient({ headless: false });
await client.init();
const bookings = await client.getCurrentBookings({ weekday: "Sat" });
console.log(bookings);
await client.close();
```

### Adding players to a booking

`getCurrentBookings()` returns bookings with a `bookingId` (parsed from each
card). Pass one back to add players:

```typescript
const bookings = await client.getCurrentBookings({ weekday: "Sat" });
const booking = bookings[0];

const result = await client.addPlayerToBooking(booking, { name: "Peter Nguyen" });
console.log(result.added);   // names successfully added
console.log(result.skipped); // e.g. { name, reason: "already-added" }
console.log(result.failed);  // e.g. { name, reason: "not-found", candidates: [...] }
console.log(result.saved);   // true once the reservation POST succeeds
console.log(result.players); // roster read back after save
```

`addPlayersToBooking(booking, players)` adds several players in one modal
session (one navigation, one save). Each `AddPlayersResult` reports:

| Field      | Type                  | Description                                              |
|------------|-----------------------|----------------------------------------------------------|
| `players`  | `string[]`            | Roster after the call (read back from the detail page on save, otherwise the original `booking.players`). |
| `added`    | `string[]`            | Players that were added and saved.                       |
| `skipped`  | `PlayerAddOutcome[]`  | Players already on the booking (`already-added`).        |
| `failed`   | `PlayerAddOutcome[]`  | `not-found`, `ambiguous` (with `candidates`), or `query-too-short`. |
| `saved`    | `boolean`             | Whether the reservation was POSTed (only when at least one player was added). |

A name must contain at least 3 letters to be searchable, and the exact
match always wins (so "Brandon Lu" selects "Brandon Lu", not "Brandon Luu").

### Options

`ClientOptions` can be passed to the `CourtReserveClient` constructor:

| Option        | Type      | Default           | Description                                              |
|---------------|-----------|-------------------|----------------------------------------------------------|
| `headless`    | `boolean` | `true`            | Run browser in headless mode (no visible window). Set `HEADLESS=false` or pass `headless: false` to see the window. |
| `manualLogin` | `boolean` | `false`           | Force manual login on init, even if saved auth exists.   |
| `authPath`    | `string`  | `./auth.json`     | Path to save/load the Playwright storage state file.     |
| `profileDir`  | `string`  | `./my-profile`    | Directory for the persistent Chromium browser profile.   |
| `debugPause`  | `boolean` | `false`           | Pause the Playwright page after init for debugging.      |

These options also have corresponding environment variables:

| Option        | Env var         |
|---------------|-----------------|
| `headless`    | `HEADLESS`      |
| `authPath`    | `AUTH_PATH`     |
| `profileDir`  | `PROFILE_DIR`   |

### First-time setup (authentication)

The first time you run the app, no saved session exists. The browser will open automatically and prompt you to log in manually:

```
Press Enter after you have logged in successfully.
```

Navigate to `https://app.courtreserve.com` in the opened browser, log in with your account, then press **Enter** in the terminal. The session is saved to `./auth.json` and reused on subsequent runs.

### Forcing a fresh login

To discard the saved session and log in again, set `manualLogin: true`:

```typescript
const client = new CourtReserveClient({
    headless: false,
    manualLogin: true,
});
```

This opens the browser and waits for you to log in regardless of whether a saved session exists.

## Run the example

### Normal (uses saved session if available)

`npm start`

or

`npx tsx examples/usage.ts`

### Force manual login

`npx tsx examples/usage.ts --force`

or

`npx tsx examples/usage.ts -f`

The `--force` flag is shorthand for `manualLogin: true`.

### Add a player (uses saved session if available)

`npx tsx examples/add-player.ts "Peter Nguyen"`

or with a forced login:

`npx tsx examples/add-player.ts "Peter Nguyen" --force`

## Development and tests

Run the test suite with:

`npx vitest run`
