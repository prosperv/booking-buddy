import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Pinned so local-time date assertions are reproducible everywhere.
    // The club is in US Pacific, and several date paths are offset-sensitive
    // (see filterBookings). A UTC runner would hide those bugs.
    env: {
      TZ: "America/Los_Angeles",
    },
    // Strips inherited HEADLESS/AUTH_PATH/etc so default-option tests are
    // deterministic regardless of the developer's shell.
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});
