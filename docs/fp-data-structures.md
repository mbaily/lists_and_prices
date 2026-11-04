# Functional-programming building blocks for the user interface

## What this document means by an abstraction

The aim is to identify a small set of established functional-programming structures that can be composed to represent most of the application. This is not a catalog of the application's nouns or their relationships.

The analysis of existing behavior uses application code only. It describes the structures in English, using their conventional FP names and mentioning Haskell and Rust counterparts without giving code or schemas. The final section records recommended technology choices for a rewrite, separately from observations about the current implementation.

There are three different kinds of claim:

- **Structural match:** the current implementation already has this logical shape, even if represented using mutable arrays or shared objects.
- **Reimplementation choice:** an established FP representation that fits the behavior, but is not literally implemented in the current code.
- **Operation or algebra:** a way to transform or summarize structures, not another data structure.

The current Yjs implementation is mutable and effectful. Identifying an FP representation does not mean the existing program is purely functional.

## 1. The small structural vocabulary

| Conventional name | What it contributes | Haskell counterpart | Rust counterpart |
| --- | --- | --- | --- |
| Product type | Several independent pieces of information together. | Records and tuples. | Structs and tuples. |
| Sum type / tagged union | A choice between distinct alternatives. | Algebraic data types, including Either. | Enums, including Result. |
| Optional value | Absence is explicit rather than a special identifier or number. | Maybe. | Option. |
| Finite map | Lookup and update by stable identity. | Map. | BTreeMap or HashMap. |
| Finite set | Unique membership independent of display order. | Set. | BTreeSet or HashSet. |
| Ordered sequence | User-controlled order, distinct from identity and membership. | Lists or Seq. | Vec or VecDeque. |
| Non-empty sequence | An ordered collection with a guaranteed first and last element. | NonEmpty, or a non-empty sequence wrapper. | A validated non-empty collection wrapper. |
| Rose tree / forest | Recursive nodes with any number of ordered children; a forest has multiple roots. | Data.Tree's Tree and Forest. | A recursive node with a collection of children. |
| Zipper | A focused position together with the context needed to navigate or reconstruct the whole. | List zippers and tree zippers. | A focus plus an explicit stack of context frames. |
| Finite relation / multimap | Many-to-many membership without duplicating the related values. | A set of pairs, or a map to sets. | A set of pairs, or a map to sets. |

**The main answer:** products and sums label an identity-indexed ordered rose forest; sets and relations describe secondary membership; optional values handle partial information; zippers describe navigation and focused editing. Most user-facing structure can be expressed by composing those building blocks.

Rust's standard collections are not persistent immutable collections. A functional Rust implementation can use ownership and explicit returned state, or choose persistent collections when structural sharing is useful. Likewise, choosing Haskell's Seq does not mean a finger tree was discovered in the existing application.

## 2. Rose tree and forest

**Status: structural match after interpreting parent links.**

A rose tree is a recursively branching tree with an arbitrary number of children at each node. It is not a binary tree. An ordered rose tree additionally gives each node's children a meaningful order. A forest is an ordered collection of such trees.

This is the strongest structural abstraction in the app: nested visible content is rendered parent-first, with ordered children and indentation. The same generic structure works at more than one organizational level. Only the labels and rules attached to nodes differ.

The current storage does not literally embed children inside immutable tree nodes. It stores identities, parent links, and positions, then derives a forest. That distinction matters during incomplete synchronization: the stored parent-link graph may temporarily contain missing parents or cycles, while the displayed result must be a readable forest.

The relevant transformation first interprets missing parents as roots and deterministically breaks cycles, then groups children, orders siblings, and traverses the result. Recovery of the display tree is separate from rewriting the stored relationships.

**Composition:** attach a product of common metadata to each node, and a sum type for its presentation alternative. Use an ordered sequence for the children. The tree is the reusable shape; the application-specific labels are parameters of that shape.

Sources: [resolveParentLinks, buildItemTreeOrder, and compareOrder](../src/lib/hierarchy.ts), [readFolders, readItems, and readAllItems](../src/lib/data.ts).

## 3. Finite map plus ordered sequence

**Status: structural match; persistent implementation is a rewrite choice.**

Identity and position are different dimensions. A finite map answers “which value has this identity?” An ordered sequence answers “in what order should these identities be encountered?”

This decomposition is useful because a value can appear in a normal traversal, a shortcut bar, a selection, and a report without becoming four independent copies. Renaming changes the value found by identity; reordering changes placement rather than identity.

The existing code repeatedly constructs identity maps and child-grouping maps from shared collections. It also computes several independent orders: sibling order, favourite order, and chronological export order.

**Composition:** maintain identity-indexed values, derive parent-to-ordered-children collections, and derive other ordered identity sequences for particular presentations. These indices and sequences need not all be authoritative stored state; some can be recomputed.

Do not force every collection into a tree. Search results and chronological exports are sequences; completion lookup is a map; selection is a set.

Sources: [identity indexing and child grouping](../src/lib/hierarchy.ts), [ordering operations](../src/lib/data.ts), [shortcut and journal projections](../src/lib/components/ListScreen.svelte).

## 4. Finite sets and finite relations

**Status: structural match.**

A finite set represents membership without duplicates. This fits selection, reachable identities, already assigned identities, active pauses, and unique tags. It does not by itself represent display order.

A finite relation is a set of pairs connecting two sets of identities. A multimap is a convenient indexed representation of that relation. This fits named-group membership and the correspondence between eligible tasks and matching destinations.

Treating membership as independent pairs is more informative than replacing an entire array of members. It also exposes the intended independence of updates to different memberships. The current shared representation includes removal markers; the visible relation is derived from those facts and any legacy baseline.

**Composition:** a map owns values, a relation selects or associates their identities, and an ordered sequence determines the presentation of the selected values. None of these operations requires copying or relocating the owned values.

Sources: [readReportAssignments and membership updates](../src/lib/reportAssignments.ts), [selectedRoots](../src/lib/hierarchy.ts), [reachable, uncovered, and assigned sets](../src/lib/nearbyErrands.ts), [grouping](../src/lib/errandGroups.ts).

## 5. Products, sums, and making illegal states unrepresentable

**Status: products already occur; stronger sums are partly a rewrite choice.**

A product says “both.” A sum says “one of these alternatives.” These are the basic building blocks of algebraic data types, not domain-specific abstractions.

Independent properties such as identity, creation time, position, and a pin flag belong naturally in a product. Alternatives such as no active editor, text editor, price editor, and quantity editor belong naturally in a sum: a user should not accidentally have several incompatible active-editor modes.

The current code often encodes such alternatives using several optional identifiers and booleans, then manually clears the incompatible fields. A sum type could carry exactly the data required by the active alternative instead.

The same distinction applies to node presentation. Some booleans describe independent properties; others effectively choose which row renderer wins. A rewrite could make the presentation choice explicit, but must decide how to handle legacy combinations. The stored flags currently permit combinations that the renderer resolves by precedence, so a cleaner sum is not automatically a lossless substitution.

**Composition:** common metadata is a product; variable content or interaction mode is a sum; each sum alternative can contain its own product. This is substantially more useful than giving every application noun its own unrelated class.

Sources: [Item and ListMeta fields](../src/lib/data.ts), [input modes, numeric buffers, row precedence, and context resets](../src/lib/components/ListScreen.svelte), [screen and dialog state](../src/lib/components/HomeScreen.svelte).

## 6. Maybe, Either, and NonEmpty

**Status: optionality already occurs; uniform failure and non-empty representations are rewrite choices.**

Maybe represents information that can legitimately be absent: a parent, price, quantity, starting point, active focus, or successful lookup. An absent value must remain distinct from a valid zero amount, false checkbox state, or empty text.

Either represents an operation that yields either a valid result or an explanation of failure. It is appropriate for structural moves, import validation, and editor initialization. The existing implementation mixes thrown errors, booleans, null results, and silent no-ops; it does not already expose a uniform Either-like command interface.

NonEmpty is particularly useful where the behavior selects the final element. The configured completion workflow has two meaningful cases: no named stages, or an ordered non-empty collection of named stages. Once the latter case is established, asking for the final stage can be total rather than a potentially failing lookup.

NonEmpty does not enforce maximum size, label uniqueness, or valid identities. Those are additional validation rules. A validated wrapper can establish them once, rather than repeat assumptions in every view.

**Composition:** a sum distinguishes the empty/default mode from the non-empty configured mode. Each configured state combines a non-empty ordered sequence of stage identities with a finite map of independent selections.

Sources: [isItemDone and named-checkbox validation](../src/lib/data.ts), [checkbox representation](../src/lib/folderCheckboxes.ts), [move validation](../src/lib/hierarchy.ts), [optional starting point](../src/lib/startingLocation.ts).

## 7. Zippers for navigation and focus

**Status: useful reimplementation choice; the current breadcrumbs are not a full zipper.**

A zipper represents a focused part of a structure plus the context around it. A list zipper keeps what lies before and after the focus. A rose-tree zipper keeps the focused subtree and context frames sufficient to move to siblings, move upward, or reconstruct the complete tree.

The user interface repeatedly needs this kind of behavior: a current position, upward navigation, sibling movement, an ancestor trail, and edits directed at a focused value. The existing code handles these using breadcrumbs, remembered cursor identities, lookups, and transient targets.

A breadcrumb containing only ancestor identities is a path, not a complete tree zipper: it lacks the surrounding sibling and parent reconstruction context. Calling the current implementation a zipper without that qualification would overstate the match.

**Composition:** a zipper over the derived ordered forest models navigation; an optional focused identity models a cursor that may temporarily be invalid. Keep selection as a separate set, because multiple selected values are not the same thing as one focus.

With collaboration, zipper contexts must be rebuilt or reconciled against current identities when peers move or delete content. A zipper alone does not solve stale-state problems.

Sources: [breadcrumbs, URL navigation, and cursor memory](../src/lib/components/HomeScreen.svelte), [list cursor and stale-target cleanup](../src/lib/components/ListScreen.svelte).

## 8. An indexed graph underneath the forest

**Status: structural match; not exclusive to FP.**

A forest handles containment, but not every connection in the app is a parent-child edge. Inline identity references, many-to-many memberships, and destination matching add non-tree connections.

A finite directed graph represented by identity-indexed vertices and edges is therefore another useful view of the whole structure. The ordered forest is a constrained projection of containment edges; other relations stay outside that projection.

**Composition:** an identity map supplies vertices, optional parent links supply one edge family, and finite relations supply other edge families. Interpret the containment family as a forest after recovery. Do not attempt to embed every cross-reference as a child, which would duplicate content or introduce unintended recursion.

Sources: [parent-link recovery](../src/lib/hierarchy.ts), [inline reference parsing](../src/lib/tags.ts), [reference resolution](../src/lib/components/ListScreen.svelte), [report relation](../src/lib/reportAssignments.ts).

## 9. Operations over these structures: folds and traversals

These are established FP operations, not additional stored entities.

### Fold / catamorphism

A fold collapses a structure into a result. A catamorphism is the general recursive-structure version: each node is interpreted using its label and the already interpreted children.

The tree can be folded into indented rows, text output, selected-root summaries, or hierarchical reports. Lists can be folded into totals and counts. Different folds over the same structure explain why the same content appears differently in different screens.

Some policies need inherited context, not just child results. Effective archive state, depth, and configuration-dependent completion require an environment passed down during traversal, possibly combined with a fold returning summaries upward. An ordinary bottom-up fold alone does not explain all of these behaviors.

The current traversal is implemented with maps and a stack; it is not literally a recursion-schemes library. Catamorphism describes a useful rewrite interface, not an imported mechanism found in the code.

### Map, filter, and flatten

Most derived screens are compositions of mapping, filtering, grouping, flattening, and sorting. A tree filter must state whether it prunes a whole branch, retains matching descendants, or preserves ancestors as context. These policies are not interchangeable.

The current report prunes branches beneath excluded parents, whereas the ordinary filtered list can show a matching descendant without showing its parent. Giving both operations the name “filter” without specifying the policy would lose behavior.

Sources: [tree traversal](../src/lib/hierarchy.ts), [list filtering and totals](../src/lib/components/ListScreen.svelte), [report recursion](../src/lib/components/SmartFolderReportScreen.svelte), [errand transformation pipeline](../src/lib/nearbyErrands.ts).

## 10. Operations over these structures: monoidal summaries

**Status: algebraic interpretation of existing calculations.**

A monoid provides an associative combination and an identity value. It is useful when independently computed summaries can be combined without changing their meaning.

- Counts and monetary contributions combine by addition, with zero as identity; Haskell commonly names this wrapper Sum.
- Reachable or selected identity sets combine by union, with the empty set as identity.
- Boolean summaries can use Any or All, depending on whether one matching member or every member is required.
- Text fragments or output sequences combine by concatenation, with an empty fragment as identity.

The price total illustrates an important distinction: multiplication of price and quantity computes one contribution; addition combines contributions. Exclusion of notes/headings and rounding to cents belong in the contribution function before the additive fold.

**Composition:** a fold can produce a product of monoidal summaries, such as a total, completed count, unfinished count, and set of tags. This is a reusable calculation pattern, not a new business entity.

Sources: [listTotal](../src/lib/data.ts), [total and completion counts](../src/lib/components/ListScreen.svelte), [set coverage and all-covered checks](../src/lib/nearbyErrands.ts).

## 11. Operations and effects: state transitions and optics

### Pure transition functions / state machines

**Status: proposed functional boundary around existing commands.**

A functional core can describe a command as a transition from a valid state to a new state and a result. Failure can be represented explicitly. Browser storage, clipboard access, GPS, network synchronization, and rendering belong outside that pure transition.

The state is a product of persistent content and interaction state; commands are a sum of supported actions. Active modes can also be sums. This is enough to model most editing interactions without introducing a new class for every screen.

A State abstraction can organize such transitions in Haskell, but invoking the State monad is not itself a data-model explanation. Start with the state and command structures and their transition rules.

### Lenses / optics

**Status: reimplementation choice, not something already used by the app.**

Lenses describe composable access and update of a part of a product. Prisms address an alternative within a sum; traversals can target multiple parts. They could provide reusable updates to metadata, a focused node, or selected values.

An optic does not validate a subtree move, preserve collaboration automatically, or replace a synchronization protocol. It is an access/update abstraction over the chosen structures. In Rust these ideas can often be expressed using ordinary accessors and explicit update functions rather than a Haskell-style optics library.

Sources: [content commands](../src/lib/data.ts), [editing state cleanup](../src/lib/components/ListScreen.svelte), [selective note sessions](../src/lib/noteEditing.ts), [delayed request guards](../src/lib/components/NearbyErrandsScreen.svelte).

## 12. The synchronization boundary is a separate algebra

CRDTs are a real additional data-structure family here: collaborative text, maps, and sequences preserve replicated update identities. They are not interchangeable with ordinary immutable maps, sets, and lists.

At the abstract replicated-state level, a join-semilattice explains merging by an associative, commutative, idempotent join. However, the app uses Yjs's concrete update protocol, deletion tracking, and conflict rules; it does not simply union the currently visible collections. A visible set alone cannot explain concurrent removal, and a visible string alone cannot explain merged text editing.

**Composition:** the FP structures describe a readable user-facing value and pure operations over it. A replication adapter translates authorized changes to and from the collaborative structures. Preserving the visible shapes is necessary but insufficient to preserve offline collaboration behavior.

Immutable structural sharing could make local checkpoint handling convenient in a rewrite. It would not, by itself, replace the existing durable historical checkpoints or selective collaborative undo. Likewise, a generic list zipper does not implement Yjs text cancellation.

Sources: [document, providers, and undo](../src/lib/yjsStore.svelte.ts), [collaborative text](../src/lib/noteText.ts), [independent memberships](../src/lib/reportAssignments.ts), [selective cancellation](../src/lib/noteEditing.ts).

## 13. How the building blocks combine

### Recursive browser

Start with identity-indexed values. Interpret containment as an ordered rose forest. Label its nodes with products and sums. Add a zipper or identity-based path for focus, and a finite set for multi-selection. A context-aware traversal produces displayed rows.

### Configurable progress

Use a sum between a default mode and a non-empty ordered configuration. Use a finite map for independent boolean selections. A pure policy interprets completion, and monoidal folds compute counts.

### Secondary collections and reports

Use a finite relation or set to select identities from the map. Derive an ordered projection rather than a copied hierarchy. Fold the selected forest using a precisely specified pruning policy.

### Location-driven planning

Use an optional origin, sequences of candidate values, a many-to-many matching relation, and sets for covered/uncovered identities. A greedy set-cover algorithm produces ordered suggestions. Set cover is an algorithm over these structures, not a specifically Haskell data structure or a guarantee of optimal routing.

### Editing and history

Use a sum for the active interaction mode, products for its required context, optional focus, and explicit transition results. Keep immutable values/checkpoints, portable copies, and collaborative operation history conceptually separate.

## 14. What not to infer from this code

- There is no evidence that a balanced search tree, finger tree, lazy stream, free monad, or full tree zipper is the current implementation simply because those tools could be used in Haskell.
- A dynamic report is not automatically a comonad; a reactive projection is not automatically a lens.
- A content fingerprint is not evidence of a Merkle tree or a complete content-addressed store.
- A checkpoint collection is not evidence that the application uses event sourcing.
- A sum type is appropriate for alternatives, not for replacing independent state flags with an artificial mutually exclusive choice.
- A persistent collection and a replicated collection solve different problems.

The useful reduction is deliberately modest: **algebraic data types, finite maps and sets, ordered sequences, rose forests, optional/non-empty values, relations, and focused context—combined through folds, projections, and explicit transitions.** That vocabulary captures the majority of the user-facing structure without renaming the application's nouns and calling them abstractions.

## 15. Rewrite choices: TypeScript, Effect, Svelte 5, and Yjs

**Status: recommended design direction, not an implemented migration or an assertion that Effect is already a dependency.**

### Client-side rendering does not substantially limit FP

The application can remain completely client-rendered in Svelte 5 while adopting an FP-oriented core. Pure transformations, algebraic data types, immutable values, folds, and explicit transitions run in the browser; they do not require server-side rendering or a Haskell runtime.

The practical constraints are JavaScript's guarantees and the collaboration boundary, not the rendering location. JavaScript does not enforce purity or immutable values. TypeScript can model products, discriminated unions, readonly interfaces, and checked alternatives, but its types disappear at runtime. Imported and external values still require runtime validation. This is not the same level of enforcement as Haskell, and readonly declarations alone do not make a JavaScript object deeply immutable.

### Recommended library: selective Effect usage with TypeScript

Use TypeScript for the structural model and Effect where its abstractions clarify absence, failure, validation, and asynchronous resource management.

- **Option:** represent legitimate absence and failed lookups explicitly.
- **Either:** represent synchronous validation or command-planning success versus failure explicitly where appropriate.
- **Schema:** validate external data and construct values satisfying documented constraints, especially at import and persistence boundaries. This means runtime validation, not a database schema.
- **Collection utilities:** support immutable transformations and, where justified, persistent collection representations.
- **Effect:** organize typed failures, asynchronous work, cancellation, dependencies, and scoped resource cleanup around browser and synchronization operations.

Keep ordinary tree traversal, completion policies, filtering, grouping, totals, and coverage calculations as straightforward pure functions. They do not need an Effect wrapper merely because the project uses the library. Rose trees, zippers, and domain-specific invariants still need an explicit model; adopting Effect does not design them automatically.

The recommendation is incremental adoption, not converting every expression into a library combinator or introducing persistent collections everywhere.

### Keep Svelte as the rendering and subscription boundary

Svelte's derived state can expose results of pure calculations to components. Its local reactive state can hold temporary interaction modes and focus. The current document-update signal already provides a place to invalidate readable projections when Yjs changes.

Svelte's lifecycle effect mechanism and the Effect library are different things despite their similar names. Component lifetimes should start and stop subscriptions or library-managed work through an explicit adapter. Avoid two independent systems treating themselves as owners of the same mutable workspace.

### Keep Yjs as the replicated-state authority

Yjs shared maps, sequences, and text remain mutable replicated structures. Ordinary immutable maps, sets, and strings cannot replace them while automatically retaining offline merging, deletion semantics, character identities, or selective undo.

The read path is: **Yjs state → readable values → pure FP projections → Svelte rendering.**

The write path is: **user command → validation and targeted change plan → Yjs transaction → updated projections.**

For shared content, readable immutable values are projections, not a second independently writable store. Interaction state and local preferences can have separate ownership because they are not the same shared facts.

Apply targeted changes to the affected identities and fields. Do not save a newly computed whole-workspace snapshot back over the document after every pure transition: that can turn independent edits into competing replacements and discard the intended granularity of collaboration. Preserve Yjs text operations and session-specific undo when adapting collaborative editors.

Validation based on a readable projection must still check that its targets and context are current when the write is applied. Local validation does not guarantee that concurrent remote commands preserve every business invariant; deterministic recovery and conflict policies remain necessary.

### Put browser effects behind adapters

Use Effect selectively for persistence operations, clipboard reads, GPS requests, session checks, and provider lifecycle management. Translate their results into explicit commands or values rather than let delayed callbacks mutate whichever screen happens to be open.

Cancellation and scoped cleanup help manage component lifetimes, but only when the underlying API adapter supports them. Some callbacks must be ignored after cancellation; a completed shared write cannot be undone merely by cancelling its task. Keep the existing destination-identity and context-lifetime checks even when using Effect.

### Alternatives considered

| Library | Suitable role | Choice for this rewrite |
| --- | --- | --- |
| Effect | Typed effects, validation, explicit results, and functional utilities. | Recommended selectively with TypeScript. |
| fp-ts | Haskell-influenced type classes and functional combinators. | A viable alternative when that style is preferred; not necessary alongside Effect by default. |
| Ramda | Functional collection and function-composition utilities. | Useful for lightweight transformations, but not the same integrated approach to runtime validation and effect lifetimes. |
| Immutable.js | Persistent immutable collection representations. | Consider only if structural sharing is needed; it does not replace Yjs replication or an effect-management layer. |

### Performance and adoption constraints

Do not clone or rebuild the entire workspace on every keystroke solely to claim immutability. Prefer scoped projections, reusable identity indices, and measured recomputation. Add persistent collections only when their sharing benefits justify conversion and integration costs.

Pure functions can be tested independently of Svelte and the network. Separately test adapters, concurrent edits, offline recovery, cancellation, and undo against actual Yjs behavior. FP-shaped values alone are not evidence that collaboration is preserved.

**Chosen direction: a functional core with an imperative, collaborative shell—TypeScript for modeling, selective Effect for effects and validation, Svelte 5 for client rendering, and Yjs for synchronization.** This is a documentation recommendation only; no dependency installation or application rewrite is included.