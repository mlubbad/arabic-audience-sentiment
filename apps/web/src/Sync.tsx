// Shim: `main.tsx` still lazily imports "./Sync" (see `main.tsx`); the real
// component moved to `ops/Sync.tsx` in the ops folder scaffold. This file is
// retired once `main.tsx` is cut over to `./ops/Sync` (Task 7).
export { Sync } from "./ops/Sync";
