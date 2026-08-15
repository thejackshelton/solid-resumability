// Witness models a project as a Vite pipeline, and `browser.visit()` starts
// the project's dev server before it opens a page. The boxes here visit
// absolute URLs on the static servers `scripts/run.mjs` puts in front of
// `demo/dist`, so this dev server serves nothing — it exists only to give the
// run a browser-capable environment named `client`.
export default {
	environments: {
		client: {},
	},
	server: {
		host: '127.0.0.1',
	},
};
