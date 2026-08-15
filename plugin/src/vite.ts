/** The Vite entry. The one bundler whose hooks can reach a dev server's HTML, which is why it is the reference target. */
import unplugin from './index.ts';

export default unplugin.vite;
