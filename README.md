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

## Development and tests

Run the test suite with:

`npx vitest run`
