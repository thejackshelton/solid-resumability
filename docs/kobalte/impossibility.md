# Why this pass cannot prove the twelve — an analyzer-level account

This is the second arm of the goal's oracle, and it is a terminal answer rather than a step toward the first one. **Nothing here resumes on the wire, and nothing here was meant to.** No analyzer source changed, no artifact was emitted, no page gained a byte. `node tools/kobalte-probe.mjs --verify` still reports 12 components, 0 provable, 12 fallback over the same seven ranked codes, and if it reported anything else this document would be void.

What follows is an account of **shapes this pass refuses**, not a report about a library. Every claim below is made about first-party source in this repo — `test/fixtures/shapes/` — and every one of them can be re-run.

## The instrument

`analyzeFixture(path, { write: false })` (`src/comptime/index.ts:36-41`) loads a project, classifies one component and touches the filesystem only to read. It is what produced every verdict quoted here, and it is why an account of this size costs zero bytes on every page in the repo.

```
npx vitest run test/shape-corpus.test.ts     # 19 assertions, the corpus and its three controls
node tools/kobalte-probe.mjs --verify        # the measurement this account explains, unmoved
```

`test/shape-corpus.test.ts` is the artifact. A reader who distrusts a sentence below can run it and read the pass's own verdict instead of mine.

## The corpus at a glance

| | Fixture | Shape | Code the pass emits | Gate that fires | Verdict |
|---|---|---|---|---|---|
| S1 | `PropTaggedHost.tsx` | host tag arrives as a prop, literal default, spread after it | `jsx-component-element` | `classify.ts:875-879`, after `:2932` and `:2060` | **TERMINAL** |
| S2 | `SpreadAfterAttribute.tsx` | `<div id="a" {...decorations()} />` | `jsx-spread` | `classify.ts:890-891` | **TERMINAL** |
| S3 | `TwoHopLiteral.tsx` | a literal that would fold, two props hops down | `jsx-component-element` | `classify.ts:2904` | **CONTINGENT** |
| S4 | `OpaqueChildrenSlot.tsx` | `{props.children}` in a lone text position | `jsx-dynamic-child-not-derivable` | `classify.ts:1600-1604` | **TERMINAL** |
| S5 | `ContextOnlyLeaf.tsx` | no `createSignal`; context read through a local wrapper | `no-signal-source` | `classify.ts:596-597` | **TERMINAL** |
| S6 | `ForeignGuard.tsx` | `<Show when={gateOpen()}>`, accessor outside the analyzed set | `show-branch-not-static-at-capture` | `classify.ts:1233` | **TERMINAL** — on the fold arm |
| S7 | `ProviderElementRoot.tsx` | the component's root is a provider element | `jsx-component-element` | `classify.ts:875-879` | **CONTINGENT** |

Six shapes, five distinct codes, no fixture earning a code that is not its own — asserted as one fact in `test/shape-corpus.test.ts`. Three further fixtures are **controls**: `LinkedGuard.tsx`, `DirectContextLeaf.tsx` and an in-memory one-hop variant of S3. They exist because a corpus in which everything refuses is consistent with a pass that refuses everything, and each control is the same input with exactly one thing changed.

## Why S1 and S2 are the whole story

Two numbers out of `docs/kobalte/profile.json` decide the shape of this document, and they are arithmetic rather than pessimism. `jsx-component-element` is on **12 of 12** pre-registered functions, 18 occurrences — it is the necessary condition for every verdict in the set. And `onlyBlockers` is **empty**, `onlyBlockerFor: 0` on every one of the seven ranked codes: no code is any component's sole blocker, so no single admission flips anything.

At all twelve, that code is earned by the same construction: a component whose host element identity is decided by a caller-supplied prop, defaulted with a literal, and followed by spreads. So S1 and S2 are not two rows of seven. They are the account, and S3–S7 describe what would still be standing if S1 and S2 fell.

That is also why "admit the three structural codes" was never a route to a verdict. `show-branch-not-static-at-capture` is on 4 components, `no-signal-source` on 3, `jsx-dynamic-child-not-derivable` on 2 — and every one of those components also carries `jsx-component-element`. Admitting all three in full, today, moves 0/12 to 0/12.

---

## S1 — a host tag that arrives as a prop

**The gate.** `classify.ts:875-879`, after both composition arms decline. Inlining declines inside `inlinableChild` at `classify.ts:2932`: the child's root must be a JSXIdentifier beginning with a lowercase letter, and the indirection's root is a framework component. Addressing declines at `classify.ts:2060`, the BARE clause: the element carries attributes. The literal `tag="p"` and the spread beside it are never audited at all — on a component element they are props, not rendered attributes (`classify.ts:880-882`), which the corpus asserts by showing `jsx-spread` absent from S1's codes.

**What the pass would have to decide.** The tag of the element that will exist in the served bytes. That value is `merge(tag: "p", ...decorate(), label: "static").tag` — the call site's attribute list folded left to right, later keys winning — and settling it means proving that `decorate()`'s return value has **no `tag` key**.

**Whether the evidence exists.** No. The key set of a function's return value is a property of a value, and the fixture makes that operational rather than rhetorical: `retag("span")` puts a `tag` in the record from anywhere, and the served element changes with no source edit. For a callee outside the component's own module the pass does not even have a name for the value — `describeCallee` (`classify.ts:696-709`) returns `opaque` for `definedIn !== moduleInfo.path` **by construction**, which is a stated boundary and not a gap in a table.

**TERMINAL, and the argument is soundness rather than absence.** Two independent legs, either sufficient.

1. *Admitting it would be unsound, not merely unimplemented.* The pass's contract is that the served bytes are what unmodified Solid renders, byte for byte, and that every locator is an element index into those bytes. A build that read the literal and templated a `<p>` would serve markup whose root element disagrees with what the page renders for any caller who spreads a `tag`. Every locator beneath it then addresses the wrong node — a false artifact, which is worse than a refusal, because a refusal falls back to ordinary Solid and this does not.
2. *The artifact vocabulary cannot state the true answer even when a human knows it.* The other arm, addressing, hard-codes the mount element: `classify.ts:2109-2112` emits `<div data-resume=… data-component=…></div>` and `types.ts:489-498` records exactly that hole. The tag is fixed at `div`. The one thing this shape varies is the one thing the record cannot carry, so "relax the BARE clause" does not reach it either.

To make S1 admissible you would need a whole-program value analysis of arbitrary cross-module call results, plus a second props boundary (the chain is call site → indirection → `<Dynamic>`, and `classify.ts:40-43` states one hop as a design invariant, enforced at `:1954`), plus a new artifact arm for a mount element whose tag is not `div`. That is three widenings across two subsystems, and the first of them is not a widening of this pass — it is a different pass.

## S2 — a spread that follows an attribute

**The gate.** `classify.ts:890-891`, on an ordinary intrinsic element. Unconditional: the pass has no spread machinery, so the attribute list is refused whole rather than analyzed and found wanting.

**What the pass would have to decide.** The element's final attribute key set — specifically whether `decorations()` supplies an `id`.

**Whether the evidence exists.** No, and for a sharper reason than S1's. The returned record is module-scope state, so its key set is not the shape of the return expression; `annotate("id", "b")` changes what the element carries. `summarize` (`src/comptime/summaries.ts:142-175`) is the pass's one interprocedural tool and it declines at clause (3), `summaries.ts:171`, because the helper captures.

**TERMINAL, scoped honestly.** The claim is about a spread **whose value is a call**, which is what the pre-registered twelve write: three spreads after `as`, two of them call results, and the callees are cross-module and therefore `opaque` by construction at `classify.ts:706-708`. Admitting that class means asserting a negative about the return shape of an arbitrary function, and asserting it wrongly serves bytes that do not match the page. A spread of an object literal is a *different* shape whose key set is syntax; this row does not claim it is impossible, and it is also not what the twelve write, so admitting it would flip nothing.

## S3 — a literal two props hops away  ·  CONTINGENT

**The gate.** `classify.ts:2904`, inside `inlinableChild`: `mod.capturesOf(fn).length > 0`. The middle component names the leaf, and naming a component captures its binding — measured in the corpus, one capture for the middle component and zero for the leaf. This is worth stating precisely because it is **one gate earlier** than the rule usually cited: `tryInlineComponent`'s own one-hop guard at `classify.ts:1954` fires inside a child's frame, and here no child frame is ever opened. The refusal therefore surfaces in the parent's frame, on the parent's element.

**What the pass would have to decide.** What `props.text` stands for inside the leaf, given a call site two hops above.

**Whether the evidence exists.** **Yes — completely, and in one module.** The literal `"settled"` is in the AST, carried unchanged through a props boundary the pass already models. The control proves it rather than asserting it: the same leaf, the same literal, one hop removed, classifies `provable` and folds the literal into the served bytes as `<span class="leaf">settled</span>`.

**CONTINGENT.** The general rule that would clear it: *composition depth is a budget, not a constant — a child that satisfies every existing inlining clause may itself compose one more such child, with the props environment carried through the second boundary the same way it is carried through the first, and the trial rolled back wholesale as it is today.* Nothing in that names a library or a shape; it is the existing six clauses applied twice.

**What would still block the verdict afterwards.** For this fixture, nothing — it would become provable, which is exactly why it is the corpus's discriminator. For the twelve, everything: the second hop is `caller → component → <Dynamic>` and the value crossing it is `as`, which S1 shows is not build-resolvable regardless of how many hops the pass can carry. Depth alone buys no verdict in the pre-registered set, which is why T002 ranked multi-hop carriage as admissible in kind and worthless in effect.

## S4 — caller-supplied markup in a lone text position

**The gate.** `classify.ts:1600-1604`, in `collectTextBinding`, when `deriveText` returns null. In the component's own frame `frame.props` is null by construction, so `propBindingOf` returns null at `classify.ts:1931` and the walk has nothing to fold. (The same code is emitted from `probeExpressionChild`, `classify.ts:1584-1588`, where the child positions were already refused.)

**What the pass would have to decide.** What markup occupies that slot, and how to recompute it at resume from captures alone.

**Whether the evidence exists.** No, and it is missing at two levels that fail independently.

- *Not in the AST.* The children are authored by whoever renders the component. There is no expression in this module whose value they are; the fact belongs to a call site in a file the analyzed set may not contain, and for a library it belongs to the application.
- *Not expressible.* Even handed the answer, the artifacts cannot say it. `StaticValue` (`types.ts:109`) is `string | number | boolean | null`; every `BindingInfo` arm (`types.ts:324`) owns a scalar; the only subtree-shaped record in the vocabulary is `ClaimedChild` (`types.ts:489-498`), and it names an artifact the build itself emitted, not markup a caller supplied.

**TERMINAL, and it is a distinct class of blocker.** A narrow predicate widens with a change confined to the deciding function, emitting an artifact the existing schema and the existing resume side already accept. This one needs a new `BindingInfo` arm, a new wire encoding, and a matching consumer under `src/resume/` — three changes spanning two subsystems that must agree, and the second and third are not the analyzer. The owner authorized analyzer widening; a resume-side contract change is a different authorization. And the soundness point stands on its own: a build that guessed the slot's markup would serve bytes for a page whose author it never met, at locators that address the guessed nodes.

## S5 — a leaf whose state arrives from a provider

**The gate.** `classify.ts:596-597`, on `signalCalls.length === 0 && contextCalls.length === 0`. The second conjunct is the interesting one: `useContextCalls` (`src/comptime/stores.ts:136-142`) counts calls to a `useContext` **imported from a Solid module in this module**. The leaf imports a local wrapper, so the count is zero and the component reads as having nothing to resume.

**The path, named.** `ContextOnlyLeaf` → `usePanel` (`panel-context.ts`) → `useContext(PanelContext)`. The wrapper resolves as a symbol; what does not happen is the *counting*, because the leaf's own module imports no `useContext` at all.

**Whether the evidence exists.** For the wrapper, yes — and the control settles the size of the claim rather than leaving it to be over-read. `DirectContextLeaf.tsx` is the same leaf with the wrapper removed: `no-signal-source` does **not** fire, and the refusal moves to `store-binding-not-provable`, about the shape of the binding. So the wrapper hides a source that exists; it is not what makes the shape unprovable. A general rule — *a call whose body is a single `return useContext(X)` counts as a declared context read* — would clear this gate and land the component on the next one.

**TERMINAL, and the reason is on the resume side, stated in its own doc comment.** `src/resume/stores.ts:50-55`: `provide(id, value)` treats a **different value for a provided id as an error**, "since two live stores under one identity is the ambiguity clause 4 refuses". The published contract is one live value per store id, page-global, enforced by throwing. Admitting a context-consuming leaf therefore requires a build-time proof that its provider is instantiated **at most once per page** — and the analyzed set is a module closure, not a page. Two mounts of the same provider is not an exotic input; it is the ordinary use of a component library. Admitting the shape would publish an artifact that throws on the page's second instance, which is precisely the unsound admission this project refuses: correct for the case anyone tested, wrong for a case nothing runs.

The evidence that would settle it — *how many times is this provider mounted on the page being served* — cannot exist in the AST, because the page is not in the AST. It is a property of an application's render tree, and the module graph the analyzer is given does not determine it.

## S6 — a region guard that is someone else's accessor

**The gate.** `classify.ts:1233`, `tryShowRegion`'s `refuseGuard`, reached because `deriveCondition` returned null: the guard is not a cell read and `deriveThroughFormatter` (`classify.ts:1890-1892`) got nothing from `summarize`.

**What the pass would have to decide.** Which branch the served markup carries. A region is a guard rather than a toggle — an absent one has no DOM and nothing on the resume side builds it — so an undetermined guard is a region the build cannot serve either way.

**Whether the evidence exists.** No, and the fixture separates two reasons that are easy to conflate.

- *The file-set edge.* `gateOpen` arrives through a bare `export * from` barrel. The project walk queues a module's **imports** (`src/comptime/project.ts:78`), and a re-export is not an import, so the module behind the barrel is never added and `Symbol.definition()` resolves to null — `summarize` declines at clause (1), `summaries.ts:152-153`. The corpus asserts the analyzed set is exactly two modules, with the accessor's module absent.
- *The reason the edge is not the cause.* `LinkedGuard.tsx` imports that module directly. The walk queues it, the definition resolves, and **the verdict does not move**: `summarize` now declines at clause (3), `summaries.ts:171`, because the accessor reads module-scope mutable state and therefore captures. A re-export rule would close the edge and change nothing here.

**TERMINAL on the fold arm, and the fold arm alone carries the verdict.** It is a soundness argument and it is independently sufficient — nothing below is needed to reach TERMINAL. The measure arm is scoped as what it is, a cost and authorization boundary, and this account does not spend it as a second impossibility.

*Fold — the terminal leg, and the argument is soundness.* The guard's value is a function of when something else ran. There is no expression in any module whose value the build could substitute, so folding means asserting a branch that a page can contradict on its first paint — serving markup for a region whose guard was false, at locators that address nodes which are not there. The evidence does not exist in the AST, and admitting the shape anyway publishes an artifact that is wrong for a case nothing runs. That is the whole verdict.

*Measure — a cost and authorization boundary, not an impossibility, and the difference is the point.* The other admissible answer is to measure the guard out of the page's own first paint, and `measured` is set in exactly two places in `derive` — a store read at `classify.ts:1690` and a region item at `classify.ts:1706` — each minting a `CaptureSlot` the resume side already knows how to resolve. A foreign accessor is neither, so measuring it means a new `CaptureSlot` kind (`types.ts:218-222`), which is a new comptime type, a new wire encoding, **and** a new branch in `src/resume/resumer.ts`'s total switch — a branch whose own comment reads "this branch ships to every resuming page" (`src/resume/resumer.ts:249`). Byte cost on every resuming page in the repo, for a shape none of them uses; and a resume-side contract change is a different authorization from the analyzer widening this tranche was granted. **No claim is made here that measuring the guard is unsound or undecidable, because none is available:** granted the authorization and the bytes, this is buildable, and an account that dressed a price up as an impossibility would be committing, inside the document that exists to forbid that conflation, exactly the conflation it forbids. The row's terminal verdict therefore rests on the fold arm; this arm is priced and left standing as a price.

## S7 — a component whose root is a provider element  ·  CONTINGENT

**The gate.** `classify.ts:875-879`. `resolveChildComponent` (`classify.ts:362-378`) resolves the name to a module-scope binding that `findComponents` never counted — a context object is not a JSX-returning function — so both arms decline and the element is refused as a nested component. The static markup underneath never reaches a template.

**What the pass would have to decide.** That the element contributes no host node of its own and hands its children straight through, so the parent's template may splice the children in and the locators below stay correct.

**Whether the evidence exists.** **Yes.** The pass already recognises Solid primitives by symbol identity — `showSymbols`, the signal factories, `createContext`/`useContext` — and already treats one framework element as template-transparent in `tryShowRegion`. A provider element's transparency is a property of the framework, established once, exactly as `<Show>`'s branch semantics are. Nothing about this fixture is undetermined: the corpus asserts the *only* reason recorded is the element, and the cell read in the `value` position does not even escape.

**CONTINGENT.** The rule: *a framework element that renders no host node and passes its children through is template-transparent — its children are walked in the parent's own address space, and it contributes no locator.* Stated over the framework's symbols, so it is general by construction and cannot be a special case for anyone's library.

**What would still block the verdict afterwards** — and this half is why the row is here. Clearing the element does not clear the component. The moment anything below the provider *reads* the provided value, the admission runs into S5's wall: the store model's clauses 4 and 5 (`src/comptime/stores.ts:1-52`) demand exactly one provider inside the analyzed set with a readable slot shape, and `src/resume/stores.ts:50-55` demands one live value per store id per page. A provider element that a page mounts twice publishes two values under one identity and throws. So R4 buys the element and the markup around it; it does not buy a tree whose state crosses the provider — and the pre-registered set is made of exactly such trees. Several of the twelve are providers and three more are leaves that read what a provider supplies — which is what `no-signal-source` on three rows of the profile records. R4 clears an element on every one of them and a verdict on none.

---

## What the controls buy

Three assertions in `test/shape-corpus.test.ts` are about a **different outcome from an almost identical input**, and without them this document is not falsifiable.

| Control | Same as | One thing changed | Outcome |
|---|---|---|---|
| in-memory `OneHop` | S3 | the middle hop removed | **provable**, literal folded into the bytes |
| `DirectContextLeaf` | S5 | wrapper removed, `useContext` called directly | `store-binding-not-provable`, and `no-signal-source` gone |
| `LinkedGuard` | S6 | barrel removed, module in the analyzed set | unchanged: `show-branch-not-static-at-capture` |

The first says the pass *can* fold this literal, so S3's refusal is machinery and not knowledge. The second says the wrapper is the load-bearing cause of S5's code, and bounds how much S5 blames it. The third is the one that keeps a terminal verdict honest: the obvious explanation for S6 — "the file was not in the analyzed set" — is measured and rejected.

## What this account does not claim

- It does not claim these shapes are impossible **in general**, only that this pass cannot admit them **soundly** under the contracts it has published — byte parity with unmodified Solid, index locators, and one live store value per id. A different design with different contracts is a different question, and this document does not answer it.
- **It does not claim that a price is an impossibility.** Where a row also names what a change would cost — a new wire encoding, a new branch in the total resolver switch that ships to every resuming page, an authorization this tranche was not granted — that is a **cost and authorization boundary**, labelled as one and never spent as a soundness leg. S4's soundness point stands on its own beside its cost; S6 is terminal on its fold arm alone and its measure arm is priced, not refused. Conflating the two is the failure this document exists to avoid, and it would be self-refuting here.
- It does not claim anything about the library's other entrypoints. The measured set is the twelve pre-registered functions in `docs/kobalte/profile.json` and nothing else.
- The nearest comparable prior art — a system that owns its source language and its emitter — specified per-instance provider scoping and did not implement it, keying state as a (module, exported name) pair with no instance dimension and a standing comment to refuse loudly until graph ids are instance-scoped. That is **corroboration that the cost is real, never authority that the thing cannot be done.** Someone else's backlog is not an argument.

---

# ERRATUM to `docs/kobalte/profile.md`

**This erratum is published in the profile itself, as `errata` in `docs/kobalte/profile.json`, rendered into the `## Errata` section of `docs/kobalte/profile.md` by `renderMarkdown`.** It is repeated here in full because the account and the correction are the same argument, and a reader of either should not have to hold the other open.

**The route to that placement is worth recording, because the obvious one is closed.** `tools/kobalte-probe.mjs` asserts that `docs/kobalte/profile.md` is byte-identical to a fresh render, and `--verify` exits non-zero on any difference — so an appended section would fail the very command that certifies the measurement this erratum is about. That obstacle is measured, not inferred: appending two lines and re-running yields `kobalte-probe --verify FAILED: - docs/kobalte/profile.md is not byte-identical to a fresh render`, non-zero, and the file was restored to its recorded bytes immediately after (SHA-256 `46cce690…`, unchanged). **Append-only was never the obstacle — any byte is**, and regeneration could not supply the text either, because the renderer builds the document from the profile alone. Hence the fix that respects the check rather than working around it: **the erratum is data beside the measurements, and the renderer emits it**, so the profile carries its own correction and still regenerates byte-identically by construction. A sibling `errata.md` was rejected on the ground that decides this — a reader of the profile would never open it, and it is the profile's own reading that needs correcting.

**The measurements are correct.** Every code in the profile is correct, both arms, all twelve; a regeneration today is byte-identical, and `--verify` says so. Nothing below asks for a row to change.

**What is wrong is a reading.** `profile.json` records `armsAgreeOnStatus: true` and `componentsWithIdenticalReasonCodes: 11`. Read casually, those two numbers invite the inference that the two arms **corroborate one cause** for each shared code. For `jsx-component-element` — the code on all twelve — they do not.

- **Source arm:** the polymorphic indirection's entry module is a bare `export * from` barrel. `loadProjectFrom` queues a module's `imports` only (`src/comptime/project.ts:78`), so the module behind the barrel never enters the analyzed set, its sole export record resolves to nothing, and `resolveChildComponent` bails at `definition() == null` (`classify.ts:373`). The arm never reaches the polymorphic machinery at all.
- **Dist arm:** rolldown has flattened that edge into a direct named import, so the definition resolves, the machinery **is** reached, and the refusal happens later — at `inlinableChild`, on clauses about captures, statement count, whole-props use and a component root.

Same code, same twelve, two different causes. The agreement is real; the corroboration it appears to offer is not.

**The operational consequence, which is the part that must not be lost.** **The source arm is not a valid measurement surface for any polymorphic-path widening.** It cannot report whether such a widening worked, because it never executes the machinery the widening would change — a rule that fixed the shape completely would move zero source-arm codes, and a rule that broke it would also move zero. Future work on that path either measures on the **dist arm**, or lands the re-export-edge rule first and regenerates afterwards. **The correct ordering is rule-then-regenerate, not regenerate-now**; regenerating today produces the same bytes and buys nothing.

This mechanism is not taken on trust. `test/fixtures/shapes/gate/` reproduces it in fourteen lines of first-party source, and `test/shape-corpus.test.ts` asserts the analyzed set of a module importing through a bare `export * from` barrel contains the barrel and not the module behind it.
