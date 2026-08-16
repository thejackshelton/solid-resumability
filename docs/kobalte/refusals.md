# Disclosure and presence — refusal receipt (A″)

Tranche 4 closes on a priced deferral of clause (A), not a resumed provider.
This receipt names the two walls that keep DialogRoot's context value off any
sound name-blind reconstruction. Nothing here authorizes a stub. The legal
join remains the one T082 §(iv) recorded: a live `DialogRoot` creates the
value; page-owned glue publishes that value by identity
(`src/resume/stores.ts:10-29,50-55,120-131`). Reconstructing a
Kobalte-internal object the artifact has not proven is body simulation
(T081 / T061 Ruling 5, reaffirmed T083, reaffirmed T085).

Cites below are drawn from T082 §(iv) and T084 §(iii)–(v). They are
measurements of installed bodies, not a grammar proposal.

## Disclosure — `createDisclosureState` return

T082 §(iv) named `isOpen`, `close`, and `toggle` as members of
`createDisclosureState`'s return that cannot be reconstructed:
the helper does not summarize; the inner primitive is an unanalyzed bare
specifier. Hand-writing `{ isOpen, close, toggle }` is the T081 standing
refusal.

T084 §(iii) measured the chain hop by hop.

Chain: `createDisclosureState` (`DV_ixT98.jsx:8-29`)
→ `createControllableBooleanSignal` (`controlled-signal:36-40`)
→ `createControllableSignal` (`:15-31`).

DialogRoot always constructs `value: () => access(props.open)`
(`DV_ixT98.jsx:10`; `C9YDO9vc.jsx:167-171` passes
`open: () => mergedProps.open`). Controlled vs uncontrolled is a
call-site prop, not a factory constant.

None of the five members reduce to owned cell + read closures:

| member | hops that do not reduce |
| --- | --- |
| `isOpen` | ComputeFunction `createSignal` thunk that re-reads `props.value?.()` / `defaultValue` (`controlled-signal:16-19`); `?? false` wrapper (`:38`); `access(props.open)` on the value thunk (`DV_ixT98.jsx:10`) — `access` itself does not summarize |
| `setIsOpen` | `accessWith(next, current)` (`:23`) — `accessWith` does not summarize; controlled-mode branch `props.value?.() === void 0` guarding `_setValue` (`:25`); `onChange` side call (`:26`); `untrack` + `Object.is` |
| `open` | `() => setIsOpen(true)` (`DV_ixT98.jsx:14-16`) — inherits every `setIsOpen` hop |
| `close` | `() => setIsOpen(false)` (`:17-19`) — same |
| `toggle` | `isOpen() ? close() : open()` (`:20-22`) — inherits `isOpen` + `open`/`close` hops |

In controlled mode `isOpen()` is a window onto an external value and
`setIsOpen` does not write the local cell. Reconstructing the five as an
artifact-owned cell would invent a source of truth — clause (C) of the
bar. The uncontrolled escape (no `open` prop) is a page fact, not a body
fact: the factory always receives a `value` thunk.

T084 §(v) names the counter-shapes a factory-return grammar would have
to refuse and cannot refuse while still admitting this chain:

1. Factory conditionally returning different closures — `asAccessor`
   (`utils:113`) returns `v` or `() => v`. `returnedClosure`
   (`summaries.ts:269-276`) correctly requires the return node itself to
   be a function.
2. Factory writing cells it does not own — `createControllableSignal`'s
   `setValue` writes `_setValue` only in the uncontrolled branch
   (`:25-26`). `setIsOpen` *is* this shape. DerivedAccessor already
   refuses a one-arg call whose callee is a parameter
   (`summaries.ts:412-428`).
3. Closures over another factory's cells — the `?? false` wrapper closes
   over the inner factory's getter; `open`/`close`/`toggle` close over
   `setIsOpen`. Second-hop ban (`summaries.ts:23-25,168-176`).
4. Non-sentinel non-literal options — `createSignal(x, INTERNAL_OPTIONS)`
   is an Identifier, not an ObjectExpression (`classify.ts:554-556`).

A grammar that admits the chain must express ComputeFunction evaluation,
prop-arity dispatch, conditional foreign-cell writes, rest-spread
application, and cross-factory closure capture. That is an interpreter
over the bodies, or it is unsound against these counter-shapes.
Option 1 (a factory-return / ComputeFunction+controlled-mode grammar) is
REFUSED-UNSOUND (T085 Ruling 2). No later task reopens it without new
upstream evidence.

T082 §(iv) clause-B consumer join: DialogTrigger uses `toggle()`,
`isOpen()`, `setTriggerRef`, `contentId()` (`C9YDO9vc.jsx:223-225`).
`setTriggerRef` and `contentId` are owned cells. **`toggle` and `isOpen`
are the illegal pair.** A reconstructed `provide` that omitted them
cannot serve the already-flipped consumer. A reconstructed `provide`
that invented them is body simulation.

## Presence — `createPresence` / `isMounted`

T082 §(iv) named `overlayPresent` and `contentPresent` as
`createPresence` returns that do not summarize. They are required for
content/overlay mount (`C9YDO9vc.jsx:100,132,143`).

T084 §(iv) asked whether any summary grammar short of executing the body
can express `isMounted`. **No.**

`isMounted` as returned (`presence/dist/index.js:89`) is
`() => isMounted() && mountedItem() !== void 0`, where both halves are
written by `createEffect` callbacks that call `setTimeout`,
`requestAnimationFrame`, and `document.body.offsetHeight`
(`:21-42`, `:73-86`). Five `createSignal(…, INTERNAL_OPTIONS)` cells,
three memos, four effects. DialogRoot even passes
`{ transitionDuration: 0 }` (`C9YDO9vc.jsx:173-174`); zero duration
does not remove the effects.

Landed matchers: `summarize` null, derived null, guarded/tree/throw-context
null. `itemShouldBeMounted` summarizing does not give `isMounted`. A
PureSummary cannot name time. A DerivedAccessorSummary requires a
returned Identifier getter (`summaries.ts:431-433`); this returns an
object of effect-driven accessors.

Presence stays deferred-execution-or-refuse — never reconstructed
(T083 Ruling 2, reaffirmed T085 Ruling 4). The deferral route this
tranche witnesses executes the real `createPresence` body inside the
lazily imported live provider.

## Tabs — selection join, class manager, factory provider, leaf trigger

Tranche 5 does not flip TabsRoot or TabsTrigger. The four walls below
are T090 Ruling 1, cited from T089's live-matcher hop table and
consumer join. They are measurements of installed bodies, not a
grammar proposal. Option-1 reconstruction (factory-return /
ComputeFunction / controlled-mode) stays REFUSED-UNSOUND and may not
be rebuilt for tabs under any name.

### 1. The selection join bottoms in the refused controlled-signal body

The trio joins on `listState` — `selectedKey` / `selectionManager` /
`collection` (T089 §(i)). The chain
(`createSingleSelectListState` → `createListState` →
`createMultipleSelectionState` → `createControllableSelectionSignal`)
terminates in the SAME `createControllableSignal` body T084 priced and
T085 Ruling 2 refused as UNSOUND (`controlled-signal/dist/index.js:15-31`).
TabsRoot always passes `selectedKey: () => mergedProps.value`
(`CezyXMlG.jsx:202`) — the identical "controlled vs uncontrolled is a
page fact, not a body fact" wall. Any grammar precise enough to admit
this chain is Option-1 reconstruction under a new name.

`createSingleSelectListState` itself (`CezyXMlG.jsx:21`) does not
summarize: 6 captures; syntaxOff includes `ObjectExpression`,
`MemberExpression`, `ArrayPattern`, `ChainExpression`,
`SequenceExpression` (T089 §(ii)).

### 2. `SelectionManager` is a class instance

`SelectionManager` (`CgkAj-2j.jsx:473`) is a class, not a getter/setter
pair. Methods close over `collection` + `state` and allocate
`new Selection()`. A grammar treating "the return is an object of
closures" as reducible admits T084 counter-shape 2/3 instantiated as
a class — unsound by the counter-shapes drawn from these very bodies
(T089 §(iii) item 3).

### 3. `createDomCollection` returns a factory-created component

`createDomCollection` (`OK7882aq.jsx:93`) returns
`{ DomCollectionProvider, items }`. `DomCollectionProvider`
(`OK7882aq.jsx:116-123`) is a factory-created component whose item
order is effect-driven (`IntersectionObserver` / `setTimeout`,
`:61-89`). A PureSummary cannot name time — the presence wall class,
T081 Ruling 3, confirmed on the body by T089 §(iii) item 4. The
provider element is rendered at `CezyXMlG.jsx:241`.

### 4. TabsTrigger's walls are downstream of the same chain

`jsx-dynamic-attribute` ×10 and `handler-not-inline` ×6 at
`CezyXMlG.jsx:279/:283` read `listState().selectionManager()` values
and `composeEventHandlers` closures; ADDRESS BARE
(`classify.ts:4264-4301`) refuses all sixteen, and claimed-child does
not apply — `<Polymorphic as="button">` is a leaf, not a provable
Kobalte callee (T089 §(iv)).

The one member that DOES reduce — the owned 0-arg
`selectedTab`/`setSelectedTab` pair (`CezyXMlG.jsx:196`, T089 §(iii)
"yes") — does not carry selection truth for the trio: `setSelectedTab`
is read only by TabsList (not in the twelve) and `selectedTab` only by
TabsIndicator (not in the twelve). Flipping what reduces would not
flip what the twelve-members consume.

No stub of `listState` / `SelectionManager` / `DomCollectionProvider`
/ any TabsContext member is authorized (T085 Ruling 2; T037/T061
Ruling 5 seam; T089 §(iv) closing). The legal join remains the
dialog one: a live `TabsRoot` creates the value; page-owned glue
publishes that value by identity.

## What this receipt does not do

It does not flip DialogRoot. It does not flip TabsRoot or TabsTrigger.
It does not admit a factory-return grammar. It does not retarget
among the twelve. `docs/kobalte/profile.md` and `profile.json` are
untouched.
