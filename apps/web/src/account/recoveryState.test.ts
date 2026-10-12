// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRecovery,
  isRecoverySession,
  markRecovery,
} from "./recoveryState";

describe("recoveryState", () => {
  beforeEach(() => {
    clearRecovery();
    sessionStorage.clear();
  });

  it("is off until a recovery link marks it", () => {
    expect(isRecoverySession()).toBe(false);
    markRecovery();
    expect(isRecoverySession()).toBe(true);
  });

  it("survives a reload: the mark is also in sessionStorage", () => {
    markRecovery();
    expect(sessionStorage.getItem("aas.recovery")).toBe("1");
    clearRecovery();
    sessionStorage.setItem("aas.recovery", "1");
    expect(isRecoverySession()).toBe(true);
  });

  it("is cleared once the password is set, in both places", () => {
    markRecovery();
    clearRecovery();
    expect(isRecoverySession()).toBe(false);
    expect(sessionStorage.getItem("aas.recovery")).toBeNull();
  });
});
