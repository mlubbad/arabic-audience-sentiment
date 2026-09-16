import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Cleanup after each test that uses React Testing Library's render()
afterEach(() => {
  cleanup();
});
