// The other half of the entry swap: the module the resumability plugin's
// `transformIndexHtml` hook rewrites `index.html` to point at.
//
// It does nothing on purpose. What is under test is whether the swap HAPPENS,
// which is a question about the served document rather than about what the
// swapped-in module then does.
console.log("[repro] resumable entry loaded — the entry swap happened");
