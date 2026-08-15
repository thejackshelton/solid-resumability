import { join } from "node:path";

import solid from "@solidjs/vite-plugin";
import { defineConfig } from "vitest/config";

import { DEMO_ROOT } from "./build/fixtures.mjs";
import { apiMock } from "./build/plugins.mjs";

/**
 * Test-only config, deliberately built from the same pieces as the production
 * one: the same `apiMock` plugin instance-for-instance, the same solid
 * pipeline, the same dedupe. A test that swapped the API module a different
 * way from the build would be testing a page the build does not produce.
 */
export default defineConfig({
  plugins: [apiMock(join(DEMO_ROOT, "src/api-mock.ts")), solid()],
  resolve: {
    // Solid 2.0 ships a server build under the `node` export condition. Tests
    // render into jsdom, so force the client (browser/development) conditions.
    conditions: ["browser", "development"],
    dedupe: ["@solidjs/signals", "solid-js", "@solidjs/web"],
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
