/**
 * A bare re-export barrel — the ordinary way a folder publishes its contents,
 * and an edge of the analyzed set.
 *
 * The project walk queues a module's IMPORTS. This file has none: `export * from`
 * is an export record, so nothing behind it is ever added, and a symbol imported
 * from here resolves to a definition that is not there.
 */
export * from "./ambient.ts";
