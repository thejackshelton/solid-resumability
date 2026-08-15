/**
 * Runs the comptime pass over the fixtures and prints the verdict.
 *
 *   pnpm comptime                       # both fixtures
 *   pnpm comptime src/fixtures/X.tsx    # one file
 *
 * Provable components get their artifacts written to `artifacts/<Component>/`;
 * refused ones print their reason codes and nothing is emitted.
 */

import { runComptime } from "./index.ts";

const DEFAULT_FIXTURES = ["src/fixtures/CounterA.tsx", "src/fixtures/CounterB.tsx"];

const targets = process.argv.slice(2);
const files = targets.length > 0 ? targets : DEFAULT_FIXTURES;

for (const file of files) {
  const { analysis, emitted } = runComptime(file);

  if (analysis.status === "provable") {
    console.log(
      `provable  ${analysis.module} (${analysis.component}): ` +
        `${analysis.cells.length} cell(s), ${analysis.bindings.length} binding(s), ` +
        `${analysis.handlers.length} handler(s)`,
    );
    for (const artifact of emitted?.files ?? []) console.log(`          -> ${artifact}`);
  } else {
    console.log(`fallback  ${analysis.module} (${analysis.component}):`);
    for (const reason of analysis.reasons) {
      console.log(`          ${reason.code} @ ${reason.loc.line}:${reason.loc.column} — ${reason.message}`);
    }
  }
}
