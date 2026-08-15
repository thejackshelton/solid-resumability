/**
 * Syntax policy for the classifier and the summaries: whitelists, so anything
 * the pass has not explicitly reasoned about is refused. They sit here to make
 * `summaries.ts` hold the SAME bar across a module boundary that `classify.ts`
 * holds inline — otherwise indirection alone opens a hole in the subset.
 */
export const HANDLER_SYNTAX = new Set([
  "ArrowFunctionExpression",
  "FunctionExpression",
  "BlockStatement",
  "EmptyStatement",
  "ExpressionStatement",
  "ReturnStatement",
  "IfStatement",
  "VariableDeclaration",
  "VariableDeclarator",
  "CallExpression",
  "Identifier",
  "Literal",
  "BinaryExpression",
  "LogicalExpression",
  "UnaryExpression",
  "ConditionalExpression",
  "TemplateLiteral",
  "TemplateElement",
  "ParenthesizedExpression",
]);

/**
 * Admitted ONLY inside an extracted handler body, and only when the structural
 * check in `classify.ts` passes too (S3): a non-computed member read over an
 * event-time base, assignment into one, and an object literal built at event
 * time for a store action. `derive` does not know them, so none folds.
 */
export const EVENT_TIME_SYNTAX = new Set([
  "MemberExpression",
  "AssignmentExpression",
  "ObjectExpression",
  "Property",
]);

/**
 * The ambient globals a handler body may name, and the exact member calls
 * admitted on each (S3, admission 2). An enumeration, not a namespace grant:
 * `Date.parse(x)`, `new Date()` and a bare `Math` stay
 * `handler-references-free-name`. Event-time only — `Date.now()` folded during a
 * build is a wrong answer, so the derivation walk never learns these.
 */
export const AMBIENT_MEMBER_CALLS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["Date", new Set(["now"])],
  ["Math", new Set(["random", "floor", "min", "max"])],
]);

/** The handler whitelist plus the declaration form; nothing else, so "impure statement" is enforced by this set. */
export const SUMMARY_SYNTAX = new Set([...HANDLER_SYNTAX, "FunctionDeclaration"]);

/** Type annotations erase before anything runs, so the walks skip them; identifiers inside a type carry `inTypePosition`. */
export function isTypeSyntax(type: string): boolean {
  return type.startsWith("TS");
}
