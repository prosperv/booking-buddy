/**
 * Runs before each test file is imported.
 *
 * src/constants.ts reads these env vars once at import time and uses `??`
 * defaults, so a value inherited from the developer's shell would change the
 * client's default options. They must be deleted (not set to ""), because
 * `??` treats an empty string as a real value.
 */
for (const key of [
    "HEADLESS",
    "AUTH_PATH",
    "PROFILE_DIR",
    "MIN_ACTION_DELAY_MS",
    "MAX_ACTION_DELAY_MS",
    "PORT",
]) {
    delete process.env[key];
}
