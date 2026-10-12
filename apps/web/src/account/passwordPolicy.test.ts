import { describe, expect, it } from "vitest";
import { PASSWORD_RULES, passwordProblems } from "./passwordPolicy";

describe("passwordProblems", () => {
  it("accepts a password with a lower, an upper, a digit and a symbol over eight characters", () => {
    expect(passwordProblems("Str0ng!pass")).toEqual([]);
  });

  it("names every rule a short digits-only password breaks (the one the live site accepted)", () => {
    expect(passwordProblems("12345678")).toEqual(["lower", "upper", "symbol"]);
    expect(passwordProblems("1234567")).toEqual([
      "length",
      "lower",
      "upper",
      "symbol",
    ]);
  });

  it("names the one missing class", () => {
    expect(passwordProblems("Strongpass!")).toEqual(["digit"]);
    expect(passwordProblems("strongpass1!")).toEqual(["upper"]);
    expect(passwordProblems("STRONGPASS1!")).toEqual(["lower"]);
    expect(passwordProblems("Strongpass1")).toEqual(["symbol"]);
  });

  it("counts letters as the server does: an Arabic letter is neither lower nor upper", () => {
    expect(passwordProblems("كلمةمرور1!")).toEqual(["lower", "upper"]);
  });

  it("lists the rules in display order", () => {
    expect(PASSWORD_RULES).toEqual([
      "length",
      "lower",
      "upper",
      "digit",
      "symbol",
    ]);
  });
});
