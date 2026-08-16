# Kobalte — supported surface on this resumability pipeline

This is the user-facing account of what the landed grammar will resume, what it
will only defer, and what it will not claim. It is bounded to the **12**
pre-registered functions in `docs/kobalte/profile.md`. It does not speak for
the rest of Kobalte.

**3 / 12 of the pre-registered functions classify `provable` (25.0%).**
(`docs/kobalte/profile.md:49`)

3 of the 12 classify provable and 9 refuse. (`docs/kobalte/profile.md:51`)

| Segment | Files | Components | Provable | Fallback | Provable fraction |
|---|---|---|---|---|---|
| `kobalte-source` | 12 | 12 | 3 | 9 | 25.0% |
| `kobalte-dist` | 6 | 12 | 3 | 9 | 25.0% |

(`docs/kobalte/profile.md:56-58`)

Supported here means those three, plus one witnessed integration pattern that
**defers execution** of a live provider. It is not a fourth provable member.
Tranche 5 closed on that pattern's generality; that closure is not charter
progress past 3/12.

---

## SUPPORTED

"Supported" means the function classifies `provable` on both arms and a Chrome
witness box asserts a **resume on the wire**: the folded intrinsic is in the
served document before any browser runs, measured attributes are the artifact's
compute (not painted strings), and the library body does not run (no fallback).

Each of the three carries `Reason set | 0 occurrence(s) across 0 code(s)` and
verdict **provable** on both arms (`docs/kobalte/profile.md:105-107`,
`:120-122`, `:230-232`). Inventory rows: `docs/kobalte/profile.md:408-409,414`.

### `SeparatorRoot`

Folded to `<hr>` on the rule page (`demo/rule.html:27`). The box
`verify/boxes/rule-resumable.box.ts:26-34,198` asserts a plain `fetch` of the
mount addressed `QhqEt4aD.SeparatorRoot` already holds `<hr>`, a11y attributes
are the shipped compute, and there is no fallback.

### `ButtonRoot`

Folded to `<button>` on the click page (`demo/click.html:22`). The box
`verify/boxes/click-resumable.box.ts:29-47,228` asserts the same served-clean
resume, plus a real Chrome click on the resumed element firing the page-owned
handler.

### `DialogTrigger`

Resumed on the dialog page (`demo/dialog.html:23`). The box
`verify/boxes/dialog-resumable.box.ts:34-37,154` asserts the trigger mount is a
hole stamped with the claimed child's artifact id, holding that child's
`<button>`, with no store-derived attribute in the served bytes. The trigger
resumes; the library `DialogTrigger` body does not run.

---

## SUPPORTED PATTERN

Priced deferral — `park` / `onMissing` / `whenProvided` — is the integration
path for provider-class components (`DialogRoot`, `TabsRoot` families).

It **defers execution** of the library's own provider until a miss. It is
**not** a resumed provider member. `DialogRoot` and `TabsRoot` stay
`fallback` in the inventory (`docs/kobalte/profile.md:413,417`). The probe
total stays **3 / 12**. Tranche 4 closed on a priced deferral of clause (A),
not a resumed provider (`docs/kobalte/refusals.md:3-4`). Tranche 5 replayed
the same kernel against tabs; that close does not claim a resumed tabs
provider member and is not progress past 3/12.

### Dialog family

Witness page: `demo/dialog.html` (live region `data-dialog-live`, resumed
`DialogTrigger` mount). Entry
`demo/src/pages/dialog-resumable.ts:26` registers `stores.onMissing` over one
memoized `import("../dialog-provider.ts")`. The provider mounts the library's
own `DialogRoot` and `provide`s the context value that body created, by
identity (`demo/src/dialog-provider.ts:19-24,36-38`). Resume-time store-read
work parks passively; the click awaits `whenProvided`
(`verify/boxes/dialog-resumable.box.ts:30-32,49-51`).

Box: `verify/boxes/dialog-resumable.box.ts:154` — deferred live DialogRoot,
resumed DialogTrigger; click fetches the provider once then flips
`aria-expanded` and mounts content; no fallback.

### Tabs family

Witness page: `demo/tabs.html` (first-party dispatch, live region
`data-tabs-live`). Load-path miss parks passively
(`demo/src/tabs-page.ts:34`); the only active wait is `whenProvided` inside
the click handler (`demo/src/tabs-page.ts:45`). Entry
`demo/src/pages/tabs-resumable.ts:25` registers `stores.onMissing` over one
memoized `import("../tabs-provider.ts")`. The provider mounts the library's
own `TabsRoot` and `provide`s `useTabsContext()` by identity
(`demo/src/tabs-provider.ts:19-21`).

Box: `verify/boxes/tabs-resumable.box.ts:27-30,100` — deferred live TabsRoot;
first dispatch fetches the provider once then live `aria-selected` flips; no
fallback. Does not move 3/12.

---

## UNSUPPORTED

The other 9 of the 12. T090 Ruling 2 walked these nine; every row carries a
measured or terminal-class wall. One line and one cite into
`docs/kobalte/refusals.md` or `docs/kobalte/impossibility.md`. Reason-set
sizes are copied from `docs/kobalte/profile.md`, not recomputed.

| member | profile reason set | wall |
| --- | --- | --- |
| `DialogPortal` | 2 occurrence(s) across 2 code(s) (`docs/kobalte/profile.md:268`) | Portal+Show fold-terminal — `docs/kobalte/impossibility.md:104-117` |
| `CheckboxControl` | 4 occurrence(s) across 2 code(s) (`docs/kobalte/profile.md:163`) | S2 leaf terminal, `dataset()` call-spreads — `docs/kobalte/impossibility.md:57-65` |
| `CheckboxIndicator` | 3 occurrence(s) across 3 code(s) (`docs/kobalte/profile.md:183`) | `Show when={present()}` — a PureSummary cannot name time — `docs/kobalte/refusals.md:102-103` |
| `TabsRoot` | 9 occurrence(s) across 3 code(s) (`docs/kobalte/profile.md:286`) | selection join bottoms in the refused controlled-signal body — `docs/kobalte/refusals.md:121-126` |
| `DialogContent` | 5 occurrence(s) across 4 code(s) (`docs/kobalte/profile.md:247`) | Show + `contentPresent()` — presence does not summarize — `docs/kobalte/refusals.md:85-86` |
| `PopoverContent` | 6 occurrence(s) across 4 code(s) (`docs/kobalte/profile.md:345`) | Show + non-provable Positioner, same fold-terminal class — `docs/kobalte/impossibility.md:104-117` |
| `CheckboxRoot` | 10 occurrence(s) across 4 code(s) (`docs/kobalte/profile.md:137`) | compound + S4 opaque children terminal — `docs/kobalte/impossibility.md:79-90` |
| `DialogRoot` | 14 occurrence(s) across 4 code(s) (`docs/kobalte/profile.md:202`) | disclosure return cannot be reconstructed — `docs/kobalte/refusals.md:17-21` |
| `TabsTrigger` | 18 occurrence(s) across 4 code(s) (`docs/kobalte/profile.md:311`) | `jsx-dynamic-attribute` ×10 and `handler-not-inline` ×6, downstream of the same chain — `docs/kobalte/refusals.md:160-165` |

No stub of a Kobalte-internal value is authorized. Flip and retarget stay
refused on these walls.

---

## THE REOPEN CONDITION

Verbatim from the tranche-5 oracle (T090 Ruling 4 / `goal.oracle.signal_tranche5`):

> 3/12 is the measured ceiling of the landed grammar absent new upstream
> evidence (statically analyzable builds of @kobalte/core and its primitives).

And the close sentence that forbids reading a later audit as charter movement:

> This tranche prices the ceiling and the kernel's generality; it does not
> claim a resumed tabs provider member, and no later audit may read its
> closure as charter progress past 3/12.

The reopen trigger is that upstream evidence and nothing else: statically
analyzable builds of `@kobalte/core` and its primitives.
