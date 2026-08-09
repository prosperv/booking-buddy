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

## Run

Start the app with:

`npm start`

You can force the manual-login flow (useful to create or refresh `auth.json`) in several ways:

- Using the convenience script (after building):

   `npm run build`
   `npm run start:manual`

- Passing the CLI flag when running the built app:

   `node dist/app.js --manual-login`

- Using an environment variable:

   `MANUAL_LOGIN=true node dist/app.js`

The `start:manual` script simply runs `node dist/app.js --manual-login`.

## Development and tests

Run the test suite with:

`npx vitest run`
