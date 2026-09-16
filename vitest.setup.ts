import { cleanup } from "@testing-library/react";
import { afterEach, beforeAll } from "vitest";

// Polyfills for jsdom's missing methods (needed for Radix Select)
beforeAll(() => {
  if (typeof HTMLElement !== "undefined") {
    if (!HTMLElement.prototype.hasPointerCapture) {
      HTMLElement.prototype.hasPointerCapture = () => false;
    }
    if (!HTMLElement.prototype.scrollIntoView) {
      HTMLElement.prototype.scrollIntoView = () => {};
    }
  }
});

// Cleanup after each test that uses React Testing Library's render()
afterEach(() => {
  cleanup();
});
