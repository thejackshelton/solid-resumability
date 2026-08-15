import { defineConfig } from "vitest/config";
import solid from "@solidjs/vite-plugin";

/**
 * Test-only config. `vite.config.mjs` (the ported one) still drives
 * `pnpm dev` / `pnpm build`; this file exists solely so vitest gets the
 * client build of Solid 2.0 inside jsdom.
 */
export default defineConfig({
  plugins: [solid()],
  // Solid 2.0 ships a server build under the `node` export condition. Tests
  // render into jsdom, so force the client (browser/development) conditions.
  resolve: {
    conditions: ["browser", "development"]
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"]
  }
});
