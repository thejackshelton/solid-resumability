// Entry point of the fixtures page, resumable variant. Substituted for
// `fixtures-classic.ts` by `resumableHtml()` in `demo/build/plugins.mjs`,
// which also inlines the emitted templates into the page's `.mount` divs.
import { resumeAll } from "../resumable-page.ts";

void resumeAll();
