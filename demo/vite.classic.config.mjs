/**
 * Classic variant — the two pages as ordinary Solid 2.0 applications.
 *
 * This file is for `pnpm dev:classic` / `pnpm preview:classic`, which serve
 * both pages together. The measured production builds go one page at a time
 * through `scripts/build.mjs`; see `build/config.mjs` for why.
 */

import { defineConfig } from "vite";

import { demoConfig } from "./build/config.mjs";

export default defineConfig(demoConfig({ variant: "classic" }));
