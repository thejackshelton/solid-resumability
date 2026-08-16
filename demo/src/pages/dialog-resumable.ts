// Entry point of the dialog page, resumable variant. Substituted for
// `dialog-classic.ts` by the plugin's HTML stage, which also inlines the
// emitted template into the page's `.mount`.
import { mountProvider, resumeAll } from "../dialog-page.ts";

mountProvider();
void resumeAll();
