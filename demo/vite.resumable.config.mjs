/**
 * Resumable variant — the same two pages, with the fixtures page delivered as
 * comptime artifacts.
 *
 * This file is for `pnpm dev:resumable` / `pnpm preview:resumable`, which
 * serve both pages together. The measured production builds go one page at a
 * time through `scripts/build.mjs`; see `build/config.mjs` for why, and for
 * the one plugin (`resumableHtml`) that makes this variant what it is.
 */

import { defineConfig } from "vite";

import { demoConfig } from "./build/config.mjs";

export default defineConfig(demoConfig({ variant: "resumable" }));
