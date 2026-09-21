/**
 * Barrel for the shared contracts.
 *
 * Split into domain modules so a feature that needs a schema does not wait on a
 * round trip. This file and jobs.ts stay coordinated between lanes: the barrel
 * is where both lanes meet, and jobs.ts is the worker-facing surface.
 *
 * `timestamp` is an internal helper shared between modules and is deliberately
 * not re-exported, so the published surface is unchanged by the split.
 */
export { LabelSchema, type Label } from "./primitives";
export * from "./filters";
export * from "./comments";
export * from "./topics";
export * from "./jobs";
export * from "./plans";
export * from "./usage";
export * from "./admin";
export * from "./sync";
export * from "./fixture";
export * from "./snapshot";
export * from "./csv";
export * from "./selection";
export * from "./channelLookup";
export * from "./ops";
export * from "./workspaceSharing";
