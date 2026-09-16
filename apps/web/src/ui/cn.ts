import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Joins class names and lets a later Tailwind utility win over an earlier,
 *  conflicting one — what every component below needs when a caller passes
 *  an extra `className` that should override a default. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
