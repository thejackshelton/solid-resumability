import { defineConfig } from "vitest/config";
import solid from "@solidjs/vite-plugin";

export default defineConfig({
  plugins: [solid()],
  // Solid 2.0 ships a server build under the `node` export condition. Tests
  // render into jsdom, so force the client (browser/development) conditions.
  resolve: {
    conditions: ["browser", "development"],
  },
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}"],
    server: {
      deps: {
        // Native zig-backed toolchain: must stay external (real `require` of
        // a .node binary), never pre-bundled or transformed by Vite.
        external: ["yuku-parser", "yuku-analyzer", "yuku-codegen"],
      },
    },
  },
});
