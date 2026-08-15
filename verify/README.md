# verify

**Cold-clone prerequisite.** This project consumes witness as `file:../../witness`, so a checkout
has to sit beside the repo root at `../witness` — `pnpm install` here fails without it. Witness
ships no `dist/` in git, so `scripts/run.mjs` builds it on the first run if `dist/witness.mjs` is
missing; that output is gitignored in the witness checkout, so running this suite never dirties it.
The runner also builds `demo/dist` itself when it is missing or older than the demo's inputs, so a
cold clone needs nothing built by hand. Chrome comes from the machine, not from this package.

Real-browser proof of the demo's network story. Six witness boxes drive a real Chrome over CDP
across the **built** demo pages, served over plain HTTP, and assert what the browser actually
requested: no fallback bundle, no handler chunk before the interaction that needs it, and working
UI either way. The classic build of every page runs the identical interactions as the control.

Run it: `node scripts/run.mjs` — builds witness and the demo if needed, serves `demo/dist/resumable`
on :4319 and `demo/dist/classic` on :4320, runs the boxes, stops the servers, exits with witness's code.

The numbers are CDP `encodedDataLength`: raw bytes on the wire plus response headers, never
compressed (the static server sends no encoding and no cache), so every total over-counts slightly
rather than flattering. Per-run request tables land in `.witness/receipts/<run>/receipt.json`.
