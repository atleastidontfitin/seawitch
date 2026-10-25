# Seawitch Language Specification

**Version:** 0.1.0-draft  
**Status:** Proposed design; not yet implemented or validated by a prototype  
**Date:** 2026-10-24

## 1. Purpose

Seawitch defines executable functions using a constrained subset of **ordinary Mermaid flowchart syntax**. A Seawitch compiler validates each graph and transpiles it into a TypeScript function. A Seawitch function may invoke other Seawitch functions or ordinary TypeScript functions. Both kinds of functions have TypeScript-compatible signatures.

**Principle:** Express only the control flow that is clearer as a flowchart. Delegate any other computation to TypeScript. Mermaid is the canonical source for a Seawitch function's behavior, not a diagram copied from an independent implementation.

This document specifies the proposed first release. Its examples are intended to render in a standard Mermaid flowchart renderer; compatibility still needs to be demonstrated through conformance tests against a pinned Mermaid version.

### 1.1 Normative terminology

**MUST**, **MUST NOT**, **SHOULD**, and **MAY** specify requirements and recommendations for a conforming implementation. Sections labeled *design rationale* or *deferred* are informative.

### 1.2 Goals

- Text-first authoring in a conventional editor; readable Git diffs.
- Direct rendering of the same source as a Mermaid flowchart.
- Explicit, statically checkable control flow and TypeScript-compatible types.
- First-class calls to ordinary TypeScript and other Seawitch functions.
- Generated TypeScript requiring no Seawitch runtime interpreter.
- Clear, source-located diagnostics for invalid programs.
- Minimal language surface: **calls, binary decisions, returns**.

### 1.3 Non-goals

- Replacing TypeScript or its ecosystem.
- A general statement language. The optional expression subset in section 13.9 does not add assignments, loops, or an effect system.
- Native loops, recursion, assignments, arrays, object constructors, pattern matching, exceptions, asynchronous execution, or mutable variables.
- A drag-and-drop editor or graphical source-of-truth format.
- Arbitrary Mermaid diagrams becoming executable automatically.
- Automatic proof of the clinical or domain correctness of a rule.

## 2. Fundamental model

Each `*.sea.mmd` file defines **exactly one function** with:

1. A name, zero or more **typed** inputs, and exactly one **typed** output.
2. One entry node.
3. Zero or more **call nodes**, each invoking a named function or evaluating one expression from the subset in section 13.9.
4. Zero or more **decision nodes**, each invoking a function that returns `boolean` or evaluating one boolean expression from that subset.
5. One or more **return nodes**.

The flowchart describes the **order of execution**, not dataflow. Outputs of function calls are immutable values bound to their node identifiers. Calls are performed only when execution reaches their node. Every execution path MUST eventually reach a return node, assuming called functions terminate and do not throw.

A call may target an ordinary TypeScript function or a Seawitch function. The calling syntax and typing rules are the same.

## 3. File format and declarations

### 3.1 File extension

A Seawitch source file MUST end in `.sea.mmd`. The compiler MUST reject any other extension, including a generated `.mmd` reader view. The file MUST contain one standard Mermaid `flowchart` declaration with direction `TD`, `TB`, `LR`, `RL`, or `BT`.

### 3.2 Directives

Declarations are placed in valid Mermaid **whole-line comments** after `flowchart`:

```mermaid
flowchart TD
    %% seawitch: function classifyNumber(value: number): Classification
    %% seawitch: import type { Classification } from "./types.js"
    %% seawitch: import { isNegative, isZero } from "./predicates.js"
    start["start"] --> negative{"call isNegative(value)"}
    negative -->|true| negativeResult["return 'negative'"]
    negative -->|false| zero{"call isZero(value)"}
    zero -->|true| zeroResult["return 'zero'"]
    zero -->|false| positiveResult["return 'positive'"]
```

The `%% seawitch:` lines MUST be ignored by ordinary Mermaid rendering and interpreted by the Seawitch compiler. The compiler MUST reject unknown `seawitch:` directives; unrelated ordinary Mermaid comments are ignored.

In v0.1:

- `function <name>(<name>: <type>, ...): <returnType>` declares the one exported function. The signature is required, including an explicit return type.
- `import { <symbols> } from "<module>"` imports callable runtime symbols.
- `import type { <symbols> } from "<module>"` imports type names.
- `vocabulary <key> = <phrase>` and `vocabulary "./file.json"` supply reader-view wording. They are presentation only. Section 14 defines them. They do not change compiled TypeScript.
- Imports MUST use statically written relative module paths. Bare package specifiers and wildcard imports are deferred.
- Imports from `.sea.mmd` resolve to generated Seawitch TypeScript modules; imports from ordinary `.js` module specifiers use TypeScript's normal source-to-output module resolution.
- Types are TypeScript type annotations, validated by the TypeScript checker. The v0.1 compiler need not implement an independent type language.

Declarations live in `%% seawitch:` comments. The executable source for a node is its quoted label. There is no second representation of the same operation.

### 3.3 Required example dependencies

The example above assumes these ordinary TypeScript declarations:

```ts
// types.ts
export type Classification = 'negative' | 'zero' | 'positive';

// predicates.ts
export function isNegative(value: number): boolean {
  return value < 0;
}
export function isZero(value: number): boolean {
  return value === 0;
}
```

The example compiles conceptually to:

```ts
import type { Classification } from './types.js';
import { isNegative, isZero } from './predicates.js';

export function classifyNumber(value: number): Classification {
  if (isNegative(value)) return 'negative';
  if (isZero(value)) return 'zero';
  return 'positive';
}
```

This is a semantic equivalence illustration. Generated formatting and variable names need not be identical.

## 4. Executable node types

A conforming compiler recognizes the following **node IDs, shapes, and labels**. The label is the only executable source for that node. IDs MUST be valid TypeScript identifier tokens and MUST be unique within the graph; they MUST NOT collide with parameter or imported symbol names.

| Node | Mermaid shape | Label | Behavior |
| --- | --- | --- | --- |
| Entry | Rectangle | `start` | Begins function evaluation; ID MUST be `start` |
| Computation | Rectangle | an expression from section 13.9, or `call functionName(arg1, arg2)` | Evaluates the expression or call, binds the result to the node ID, follows its one successor |
| Decision | Diamond | a boolean expression from section 13.9, or `call predicateName(arg1, arg2)` | Evaluates the expression or call; follows exactly one `true` or `false` edge |
| Return | Rectangle | `return <expression>` | Returns the expression; no successor |

`call name(args)` remains valid. New graphs SHOULD write the call as an expression, `name(args)`, so the diagram shows the same text TypeScript will run. A `return` whose operand is a parameter, a node id, or a literal uses that operand directly. Any other operand is an expression from section 13.9.

Node IDs, shapes, and executable labels carry semantics; visual style, graph direction, and layout do not. The entry node MUST be a rectangle named `start` with label `start` and no incoming edges. It MUST have exactly one outgoing edge unless it is the only executable node in an explicitly supported future extension; v0.1 does not permit such empty functions.

A call node MUST have exactly one outgoing edge. A decision node MUST have exactly two outgoing edges, with labels **exactly** `true` and `false`; either may point to the same target node. Return nodes MUST have no outgoing edges.

Executable nodes MUST be connected to the entry. An unsupported shape, label, edge format, or disconnected executable node is a compile-time error. Subgraphs, click handlers, hyperlinks, and Mermaid's other executable-looking features do not acquire Seawitch meaning in v0.1.

## 5. Arguments, values, and types

### 5.1 Argument grammar

Each call supplies a comma-separated list of arguments in the same order as the callee's signature. An argument is one of:

- A function parameter identifier.
- The node ID of a previously evaluated call or decision.
- A primitive literal: a single-quoted string, decimal number, `true`, `false`, or `null`.

The `call name(args)` form accepts only that argument grammar. Property access, comparisons, and other expressions belong in the subset in section 13.9, written directly as the node label.

A return of a parameter, node id, or literal uses that value. A return of any other expression uses section 13.9. The value MUST be assignable to the function's declared output type.

### 5.2 Node results and control-flow merges

For a call or decision node `risk`, the name `risk` denotes that node's returned value.

A graph MAY have converging paths. However, a node result may be referenced only if its producing node is guaranteed to have been executed **on every path** reaching the reference (*dominance rule*). This prevents reading values defined only on one branch. Parameters and literals are available on all paths.

For v0.1, when branches compute different values intended as a common output, the preferred pattern is to return separately from each branch or to move the computation into a helper function. No `phi` nodes or mutable assignments are required.

### 5.3 Type checking

The compiler MUST check:

- Imported functions and types resolve.
- Function calls have valid argument counts and compatible parameter types.
- Decision calls and decision expressions have a type assignable to primitive `boolean`. `any`, `unknown`, nullable unions (`null` or `undefined` in the type), and non-boolean types are rejected. A type alias of `boolean` is accepted. The literal type `true` is accepted because it is assignable to `boolean`. Truthy or falsy values of other types are not.
- Node references satisfy the dominance rule.
- Every return value is compatible with the declared return type.
- A call to another Seawitch function is checked by the same rules as a call to a TypeScript function.

Overloads, generic function declarations, rest parameters, and asynchronous/Promise-returning calls are **outside the required v0.1 subset**. They can be used behind monomorphic, synchronous TypeScript adapter functions.

## 6. Execution semantics

1. The generated function receives its arguments, then starts at the entry node.
2. Upon reaching a call node, evaluate its legacy call or its expression **once**, bind the result to that node ID, and continue to the sole successor.
3. Upon reaching a decision node, evaluate its legacy Boolean call or its boolean expression **once**, then follow the matching labeled edge.
4. Upon reaching a return node, evaluate its single operand or its expression and immediately return it.
5. Nodes not on the selected execution path MUST NOT execute.
6. If a called function throws, the exception propagates normally to the caller; v0.1 adds no catch/finally semantics.

The compiler MUST preserve observable call ordering and must not speculatively evaluate unchosen branches. TypeScript functions MAY have side effects; Seawitch itself adds no hidden side effects. Pure helper functions are recommended, not required.

### 6.1 Termination constraints

V0.1 graph edges MUST be acyclic. Seawitch-to-Seawitch function references MUST also be acyclic; direct and indirect graph recursion are rejected.

The compiler MUST reject graphs with a reachable path that fails to terminate at a return node. These constraints guarantee termination of the **graph's own control flow**, conditional on external TypeScript calls terminating; they do not imply arbitrary imported TypeScript code cannot loop, recurse, or throw.

## 7. Graph composition example

A composed function can call other Seawitch functions or TypeScript functions without differentiating them in its graph:

```mermaid
flowchart TD
    %% seawitch: function assessExposure(exposure: Exposure): Assessment
    %% seawitch: import type { Exposure, Assessment } from "./types.js"
    %% seawitch: import { deriveRisk } from "./deriveRisk.sea.mmd"
    %% seawitch: import { composeAssessment } from "./assessmentCopy.js"
    start["start"] --> risk["call deriveRisk(exposure)"]
    risk --> assessment["call composeAssessment(exposure, risk)"]
    assessment --> result["return assessment"]
```

Here `deriveRisk` is Seawitch-defined and `composeAssessment` is TypeScript-defined. Their implementation languages do not change the calling contract. `deriveRisk` must be exported under that name from its own one-function `.sea.mmd` file.

## 8. Compiler contract

### 8.1 Required stages

A conforming compiler MUST:

1. Read and validate the file as Mermaid flowchart syntax against a **documented, pinned Mermaid version**.
2. Parse only the explicit Seawitch subset and extract declarations, nodes, and edges. A node's executable meaning is its label.
3. Construct a typed intermediate representation of the control-flow graph.
4. Resolve imports and build the graph-to-graph dependency graph.
5. Verify shape, graph structure, branch completeness, acyclicity, reachability, dominance, and return completeness.
6. Check signatures, return types, and invocation types using TypeScript-compatible resolution.
7. Emit ordinary `.ts` source corresponding to each Seawitch function, with deterministic output from a given input and configuration.
8. Emit source-located errors that mention the Mermaid filename and relevant line and node where possible.

The compiler MAY use Mermaid's tooling for rendering/syntax checking and its own parser for the stricter executable subset. Merely passing Mermaid parsing does **not** constitute Seawitch validity.

### 8.2 Output and integration

Given `src/assessExposure.sea.mmd`, the default compiler layout SHOULD generate `generated/assessExposure.ts`, maintaining source-relative directory structure. Imports of sibling Seawitch graphs are rewritten to corresponding generated TypeScript module paths. Ordinary TypeScript imports MUST be rewritten as necessary to continue resolving to the **same original module** when output files live in a different directory; preserving a relative import string verbatim is not sufficient if it changes its target.

The generated module exports the declared function name. It must compile under a documented supported TypeScript version. No extra runtime engine, graph interpreter, browser APIs, React, or clinical library is required.

The compiler SHOULD avoid changing generated files when source output is unchanged. Generated files SHOULD be clearly marked as generated and not manually edited.

### 8.3 Errors

A valid diagnostic includes an error category, human-readable explanation, source file, and preferably source span/node ID. Compilation MUST fail on invalid graph semantics rather than silently inventing branches, return values, or default behavior.

Examples:

```text
SW104 assessExposure.sea.mmd:14 [withinWindow]:
Decision is missing a 'false' outgoing edge.

SW203 assessExposure.sea.mmd:20 [recommend]:
Argument 'risk' may not be defined on all incoming paths.

SW301 assessExposure.sea.mmd:11 [isEligible]:
Decision call must return boolean; actual return type is RiskTier.
```

The codes above are proposed examples, not an implemented diagnostic registry.

## 9. Minimum conformance suite

An implementation of v0.1 MUST include automated positive and negative tests for the following cases:

| # | Test | Expected |
| --- | --- | --- |
| 1 | One function with an ordinary TS helper and return | Correct compiled value |
| 2 | A binary decision with distinct return leaves | Correct true/false behavior |
| 3 | A TypeScript helper returning a typed object | Typed output preserved |
| 4 | One Seawitch graph calling another | Correct runtime behavior and imports |
| 5 | Nested decisions | Correct output on all paths |
| 6 | A call on an unchosen branch | That call is not executed |
| 7 | Missing true or false branch | Compile-time error |
| 8 | Invalid Boolean predicate return type | Compile-time error |
| 9 | Referencing a branch-local value after a merge | Compile-time error |
| 10 | Cycle inside a flowchart | Compile-time error |
| 11 | Circular dependency between Seawitch functions | Compile-time error |
| 12 | Reachable path without a return | Compile-time error |
| 13 | Wrong number/type of function arguments | Compile-time error |
| 14 | Missing import or unknown called function | Compile-time error |
| 15 | Invalid Mermaid syntax | Render/parse error before code generation |
| 16 | Valid Seawitch graph | Diagram renders in pinned stock Mermaid |
| 17 | A TypeScript function calling generated Seawitch code | Works with standard TS imports |
| 18 | Same inputs compiled twice | Identical emitted source |

Both Mermaid rendering tests and generated TypeScript execution tests SHOULD be included in continuous integration.

## 10. First implementation milestone (not the full product)

The first prototype SHOULD implement only this vertical slice:

- Compile the `classifyNumber.sea.mmd` example.
- Render its original `.sea.mmd` as a Mermaid diagram without preprocessing.
- Produce type-checked TypeScript that passes the three negative/zero/positive tests.
- Diagnose a missing decision edge and an incorrect return type.
- Demonstrate one Seawitch graph calling another.

**Success criterion:** the same `.sea.mmd` source is simultaneously readable Mermaid and an executable, type-checked TypeScript function specification, with no manually synchronized diagram or implementation.

Only after this milestone should the team attempt a production WhatNext.Health decision channel or an entire assessment slice.

## 11. Proposed decisions awaiting prototype feedback

The following are specified provisionally for v0.1 but should be evaluated through implementation rather than accepted as permanently optimal:

1. **Metadata in `%% seawitch:` comments.** Preserves stock Mermaid compatibility while keeping signature and imports with the diagram.
2. **Meaning in node labels.** The quoted label is the expression, call, or return that runs. The diagram shows the same text that determines execution.
3. **No branch-merge value selection.** Separate returns and helper calls keep the semantics small; real examples may justify a narrowly scoped merge construct later.
4. **Strict synchronous and acyclic graph subset.** Easy to validate, but intentionally does not address every possible algorithm.
5. **Dependency resolution through explicit imports.** Keeps name resolution deterministic and aligns with ordinary TypeScript conventions.

These are design choices for testing, **not evidence that the compiler has already been implemented**.

## 12. Deferred capabilities

Explicitly out of scope for v0.1: loops, recursion, async/await, expressions outside the subset in section 13.9, arbitrary assignments, structured literals, exception handling, visual editing, automatic graph extraction from existing TypeScript, automatic clinical claim tracking, integrated execution tracing, and UI frameworks. They can be proposed individually if real code examples demonstrate enough value.

## 13. Prototype decisions

These decisions are normative for the Milestone 1 prototype. They narrow the draft above where it was ambiguous. They do not add loops, recursion, a visual editor, or a Seawitch runtime.

### 13.1 Flowchart subset

A v0.1 source file is one statement per line. A trailing semicolon is optional. The header direction is `TD`, `TB`, `LR`, `RL`, or `BT`. The only links are `-->`, `-->|true|`, and `-->|false|`. Executable node labels are double-quoted. The entry node `start` has exactly one unlabeled outgoing edge.

The following are compile errors: YAML front matter, chained edges, `&` forks, subgraphs, `click` and `href` statements, and `@{ }` shape syntax. Ordinary `%%` comments are ignored. Unknown `%% seawitch:` directives are errors.

### 13.2 Declarations

A file has exactly one `function` directive. Imports are only:

- `import { A, B } from "./mod.js"`
- `import type { A, B } from "./mod.js"`

Specifiers are relative. Aliases, wildcards, and default imports are rejected. A `.sea.mmd` import's local name must be that file's declared function. A Seawitch module exports only that function.

The compiler parses `function` and `import` directives with the TypeScript parser (`ts.createSourceFile` on the directive text). It does not implement a second TypeScript grammar. Type text is copied from the TypeScript AST and checked by TypeScript **5.9.3**.

### 13.3 Identifiers and literals

Identifiers are non-reserved TypeScript identifiers. They are not Mermaid statement keywords: `end`, `subgraph`, `graph`, `flowchart`, `click`, `call`, `href`, `style`, `class`, `classDef`, `default`, `linkStyle`, `direction`, `interpolate`. They must not collide with the function name, parameters, imports, or other node ids.

Literals are `true`, `false`, `null`, single-quoted strings with `\\` and `\'` escapes, and optional-minus decimal numbers such as `-1` and `1.5`. `undefined` is not a literal.

A value reference is a parameter, or the id of a call or decision node that strictly dominates the use. Decision nodes bind their boolean result. The entry and return nodes do not produce referenceable values.

### 13.4 Decision types

A decision callee is accepted when its return type is assignable to primitive `boolean` and is not `any`, `unknown`, a nullable union (`null` or `undefined` in the type), or a non-boolean type. A type alias of `boolean` is accepted. The literal type `true` is accepted.

Generic functions, overloads, rest parameters, and `Promise`-returning callees are rejected. Wrap them in a monomorphic synchronous TypeScript adapter.

### 13.5 Mermaid compatibility

The same unmodified `.sea.mmd` bytes must render in a pinned Mermaid release. That render is a conformance test. The compiler does not paint diagrams and does not load a DOM. `seawitch render` writes a separate Mermaid file; it does not execute the graph. Invalid subset syntax is a Seawitch diagnostic.

The Milestone 1 conformance render uses Mermaid **12.2.0**.

### 13.6 Diagnostics

A diagnostic has the form `CODE file:line [nodeId]: message`. The node id is omitted when the error is not tied to a node. Initial codes:

- `SW010`–`SW015`: syntax and declarations.
- `SW016`: a node label whose expression is outside the subset in section 13.9.
- `SW018`: a vocabulary mapping or reader-view output path that is duplicate, conflicting, invalid, or unsafe.
- `SW101`–`SW109`: graph structure. `SW104` is a missing `true` or `false` edge. `SW108` is a cycle in the flowchart. `SW103` means structured emission still had to duplicate a region and stopped after 2,000 nodes.
- `SW203`: a reference that does not dominate the use.
- `SW301`: a decision return type that fails the boolean rule.
- `SW302`: a return value not assignable to the declared return type.
- `SW303`: an argument count or type mismatch.
- `SW304`: a generic, overloaded, rest, or asynchronous callee.
- `SW401`–`SW404`: imports and cycles between Seawitch files.

There is no compiler-stage Mermaid or DOM failure code. A file that is not in the supported subset fails with a syntax diagnostic. Rendering failures are reported by the conformance test.

### 13.7 Code generation for joins

The emitter computes immediate postdominators on the flowchart, with a synthetic exit after every return. For a decision, the nodes that appear on only one side are emitted inside `if` / `else`. The immediate postdominator is emitted once after the conditional. A decision whose true and false edges already target that postdominator emits the predicate call and then the continuation, with no empty conditional. Sequential diamonds and diamonds nested inside one arm therefore grow linearly. Call order and side effects follow the taken path.

Some acyclic graphs have no single continuation for a decision. The smallest case is two decisions that cross into the same pair of successors: the true arm of the outer decision reaches one successor, and the inner decision reaches both. Neither successor postdominates the outer decision, so each successor is emitted on every path that reaches it. Only the taken copy runs. That duplication is the fallback. It is not a branch-merge value and it does not relax dominance.

If that fallback would emit more than 2,000 nodes, compilation stops with `SW103` and writes nothing. A cascade of crossing decisions can reach that guard from a small diagram. Ordinary sequential and nested diamonds do not. The guard is a prototype limit on duplicated regions, not a limit on graphs the language accepts.

### 13.8 Converging example

`examples/order/fulfillOrder.sea.mmd` is a non-clinical function with a structured input, intermediate call results, a boolean decision, a converging path, and a structured output. The shared call may use values that dominate the join, including the decision's boolean result. A branch-local result is not a legal argument to that shared call. The source remains ordinary Mermaid. The generated function emits the shared call once, after the conditional.

### 13.9 Expression labels

A diamond label that does not use `call name(args)` is a boolean expression. A rectangle label that is not `start`, `return <value>`, or `call name(args)` is an expression whose result is bound to the node id. A return may also be `return <expression>` when the operand is not a single parameter, node id, or literal.

The expression is the label text. The compiler parses it with the TypeScript parser and then checks this subset:

- An identifier in scope: a parameter, an import used as a callee, or a dominating node result.
- Property access with `.`, and a call or method call.
- Prefix `!`, parentheses, and the operators `===`, `!==`, `<`, `<=`, `>`, `>=`, `&&`, and `||`.
- A single-quoted string, a decimal number including a leading minus on that number, `true`, `false`, or `null`.

`&&` and `||` keep TypeScript's short-circuit evaluation because the compiler emits the expression text. A conditional expression is rejected so each alternative stays a flowchart branch.

The subset does not guarantee purity. A function or method call inside an expression may have side effects, just as a legacy Seawitch call may. There is no effect system. Explicitly mutating syntax is rejected, including assignment, update, `delete`, `new`, `await`, `yield`, `void`, `typeof`, the comma operator, postfix `++` and `--`, optional chaining, non-null assertions, `as`, `satisfies`, object and array literals, template literals, arrows, generic type arguments, and spread.

Loose equality is rejected. An expression uses `===` or `!==`, not `==` or `!=`.

A bare function name used as a callee MUST be a value import. A method name is not an import. Calls inside the expression are checked by the same callee rules as a legacy call, including the rejection of generic, overloaded, rest, and `Promise` callees. Identifiers that are not callees follow the dominance rule. The compiler emits the original expression text in parentheses. It does not pretty-print it.

---

## 14. Reader view

This section is presentation. It does not change section 6 or the compiled TypeScript. A vocabulary phrase can be inaccurate. The generator keeps the reader view consistent with the mapping. It does not check that the phrase is clinically correct.

`.sea.mmd` is the executable source. Developers maintain it. Node labels are the expressions that run. `seawitch render <files.sea.mmd...> --out <dir>` reads that source and writes one `name.mmd` per file into the output directory. The output is a normal Mermaid flowchart. It has no `%% seawitch:` lines, and the compiler refuses to compile it. The command never writes a `.sea.mmd` file and never writes over its input. Running it twice on the same source produces the same bytes. Generated files carry `%% Generated by Seawitch. Do not edit.` and are not maintained by hand. Check them for drift, or regenerate them, rather than editing them.

A vocabulary entry maps one identifier, property path, or literal to a phrase:

```text
%% seawitch: vocabulary ctx.risk = risk
%% seawitch: vocabulary 'high' = high
%% seawitch: vocabulary ctx.pep_window['unknown_timing'] = unknown
%% seawitch: vocabulary "./risk-vocabulary.json"
```

The JSON file is an object of those same keys to phrases. Paths are relative to the source file. A key that is a comparison, a call, or any other expression is rejected. `subject['literal']` is not a condition. It sets the wording of that literal only when it is compared with that subject. `ctx.pep_window === 'unknown_timing'` can read `unknown` while `strength === 'unknown_timing'` keeps the global phrase `unknown timing`. A bare literal, including one in `return`, uses the global phrase. The lookup order is the subject-specific phrase, then the global literal phrase, then the source text. A contextual mapping is optional. Defining the same identifier, path, literal, or subject-and-literal pair twice is an error, including two spellings such as `ctx.pep_window['unknown_timing']` and `ctx . pep_window [ 'unknown_timing' ]`. A missing vocabulary file is an error. A phrase is one line of text. Mappings are not whole-decision sentences kept beside the expression. An unused mapping is allowed, so one JSON file can serve several functions.

The generator walks the TypeScript AST of each label. `===` is rendered as `is`, `!==` as `is not`, `&&` as `and`, `||` as `or`, and `!` as `not`. Parentheses follow the AST, and `and` / `or` stay grouped when they appear together. A chain of `===` comparisons with the same safe subject collapses: `risk is high or moderate`, and for three or more values `risk is high, moderate, or low` with an Oxford comma. Each literal in that list uses the subject-specific phrase when one exists. A different subject stays outside that list. The subject is safe when it is an identifier or a property path. A call is not safe, and a chain of `!==` is not collapsed. A mapped name replaces that node only. Anything the plain-language rules do not cover is copied from the source text of that subtree. `start` is rendered as `Start`. A return renders its operand, with a bare `true` or `false` rendered as `True` or `False`. Ordinary `%%` comments are kept. `%% seawitch:` lines are not.

A decision diamond whose whole expression is a direct call may become one English question. The call is `name(arguments)` or the legacy `call name(arguments)`. The callee is an identifier. A method, a computed callee, a negated call, and a call inside `&&` or `||` stay in source form. A computation node and a return node stay in source form too.

The type checker must see exactly one call signature for that name. The signature has no type parameters and no rest parameter. Its return type is a non-nullable boolean. `any`, `unknown`, and a `Promise` result do not qualify. The same boolean rule is the one decisions already use. If the checker cannot see that result, the call stays in source form.

The question is assembled from the function name and the vocabulary. It is not a sentence stored for that function. A vocabulary key that is a call is rejected, so the vocabulary cannot supply the finished question. Changing the name changes the question. Changing the function body does not. The name can still describe the body badly. Seawitch keeps the reader view consistent with the name and the declared boolean result. It does not check that the body does what the name says.

The name is split on camelCase boundaries. `veryLowRisk` is `very`, `Low`, `Risk`. An all-caps run stays one token, so `HIV` in `labIsHIV` stays `HIV`. Write the marker as its own PascalCase token.

`SubjectIsPredicate` uses one `Is` token, with text before and after it. `actIsExcludedFromRoutineHivPep`, `infectionIsConfirmed`, `pepWindowIsLate`, and `courseIsCompleted` match. The question is `Is <subject> <predicate>?`.

`SubjectVerbComplement` uses one verb token from this list, again with text on both sides:

| Name token | Question verb |
| --- | --- |
| `Excludes` | exclude |
| `Overrides` | override |
| `Supports` | support |
| `Requires` | require |
| `Allows` | allow |
| `Replaces` | replace |

The question is `Does <subject> <verb> <complement>?`. `intactBarrierExcludesRoutineHivPep` matches. `veryLowRiskExcludesRoutineHivPepBeforeWindow` takes `veryLowRisk` as the subject and `RoutineHivPepBeforeWindow` as the complement. No other verb is recognized. A final `s` is not removed from an unknown word. `Exclude` is not `Excludes`. Two markers, or both `Is` and a listed verb, do not match.

The subject and the complement are read from left to right. The longest vocabulary identifier covering the next tokens is used. Its key is those tokens in camelCase: `act`, `intactBarrier`, `veryLowRisk`, `routineHivPep`, `pepWindow`, `beforeWindow`, `completedCourse`, `recommendation`, `pep`. A one-token all-caps run keeps its capitals in the key. An unmatched token is lower case, except an all-caps token, which is copied unchanged. The phrase supplies articles and acronyms. The generator does not insert `a` or `the` by itself, so `act` is mapped as `the act` and `routineHivPep` as `routine HIV PEP`. These keys are ordinary identifier mappings. A bare use of the same identifier, including an argument of a call that stays in source form, receives the same phrase.

If two covers use the vocabulary equally well and the words differ, the call stays in source form. Mapping both `routineHiv` and `hivPep`, and not `routineHivPep`, is that case. The question starts with `Is` or `Does` and contains one `?` at the end. A phrase that already contains `?` cancels the question.

With those phrases, the HIV PEP calls read:

- `actIsExcludedFromRoutineHivPep(ctx, profile)` reads `Is the act excluded from routine HIV PEP?`
- `intactBarrierExcludesRoutineHivPep(ctx, profile)` reads `Does an intact barrier exclude routine HIV PEP?`
- `veryLowRiskExcludesRoutineHivPepBeforeWindow(ctx, profile)` reads `Does very low risk exclude routine HIV PEP before the window?`
- `completedCourseReplacesRecommendation(ctx, mapped)` reads `Does a completed course replace the recommendation?`

## Appendix A. Minimal syntax summary

```text
file:         <name>.sea.mmd
header:       flowchart TD|TB|LR|RL|BT
signature:    %% seawitch: function name(arg: Type, ...): ReturnType
import:       %% seawitch: import { symbol } from "./module.js"
type import:  %% seawitch: import type { Type } from "./types.js"
vocabulary:   %% seawitch: vocabulary key = phrase
vocab literal: %% seawitch: vocabulary subject['literal'] = phrase
vocab file:   %% seawitch: vocabulary "./vocabulary.json"
entry:        start["start"]
computation:  node["expression"]
decision:     node{"boolean expression"}
true edge:    decision -->|true| target
false edge:   decision -->|false| target
return:       node["return expression"]
legacy call:  node["call helper(arg, ...)"]
legacy test:  node{"call predicate(arg, ...)"}
```

All these declarations are interpreted only where the full source also satisfies the supported Mermaid flowchart subset. This appendix is a summary, not a separate grammar.

## Appendix B. Design philosophy

**Seawitch is not intended to make everything graphical.** It makes it possible to choose a flowchart wherever a flowchart improves clarity, while retaining TypeScript for all remaining work. The developer, not the language designer, chooses the boundary.
