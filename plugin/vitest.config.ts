/** Node environment only: everything under test here runs beside a build, never in a page. */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // The byte-parity test runs the pass over the whole corpus and the exports
    // test shells out to `npm pack`; both are slower than a unit test and
    // neither is hung.
    testTimeout: 120_000,
  },
});
