// Entry point of the rule page, resumable variant. Substituted for
// `rule-classic.ts` by the plugin's HTML stage, which also inlines the
// emitted template into the page's `.mount`.
import { resumeAll } from "../rule-page.ts";

void resumeAll();
