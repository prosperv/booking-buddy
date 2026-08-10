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

## Run the example

`npx tsx examples/usage.ts`

`npm start`

## Development and tests

Run the test suite with:

`npx vitest run`
