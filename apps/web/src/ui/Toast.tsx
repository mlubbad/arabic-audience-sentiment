import { useSyncExternalStore, type ReactNode } from "react";
import * as ToastPrimitive from "@radix-ui/react-toast";
import { cn } from "./cn";

interface ToastItem {
  id: number;
  title: string;
  description?: ReactNode;
}

let items: ToastItem[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return items;
}

/** Queues a toast. The module-level store (not React context) is the same
 *  shape `locale.ts` already uses, and for the same reason: `toast()` must
 *  be callable from a mutation's onSuccess handler, far from any provider,
 *  with nothing to forget to wrap. */
export function toast(input: { title: string; description?: ReactNode }) {
  items = [...items, { id: nextId++, ...input }];
  emit();
}

function dismiss(id: number) {
  items = items.filter((i) => i.id !== id);
  emit();
}

/** Mounted once, at the app root (`main.tsx`). Every `toast()` call anywhere
 *  in the app renders through this one host. */
export function ToastHost() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {current.map((item) => (
        <ToastPrimitive.Root
          key={item.id}
          className="ui-toast-root"
          duration={5000}
          onOpenChange={(open) => {
            if (!open) dismiss(item.id);
          }}
        >
          <ToastPrimitive.Title className="ui-toast-title">
            {item.title}
          </ToastPrimitive.Title>
          {item.description && (
            <ToastPrimitive.Description className="ui-toast-description">
              {item.description}
            </ToastPrimitive.Description>
          )}
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className={cn("ui-toast-viewport")} />
    </ToastPrimitive.Provider>
  );
}
