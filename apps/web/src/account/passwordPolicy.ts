/**
 * The password rules, checked on the form so it can say what is missing
 * before the round trip. They mirror what the Supabase project enforces
 * (`minimum_password_length = 8`, `password_requirements =
 * lower_upper_letters_digits_symbols`): the server's answer still wins, and a
 * `weak_password` error is shown with the server's own reasons.
 *
 * The classes are ASCII, as GoTrue defines them: an Arabic letter counts for
 * neither "lower" nor "upper" there, so it must not count here either.
 */
export const PASSWORD_MIN_LENGTH = 8;

export type PasswordRule = "length" | "lower" | "upper" | "digit" | "symbol";

/** GoTrue's symbol set for `lower_upper_letters_digits_symbols`. */
const SYMBOLS = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/;

const RULES: readonly [PasswordRule, (pw: string) => boolean][] = [
  ["length", (pw) => pw.length >= PASSWORD_MIN_LENGTH],
  ["lower", (pw) => /[a-z]/.test(pw)],
  ["upper", (pw) => /[A-Z]/.test(pw)],
  ["digit", (pw) => /[0-9]/.test(pw)],
  ["symbol", (pw) => SYMBOLS.test(pw)],
];

export const PASSWORD_RULES: readonly PasswordRule[] = RULES.map(([r]) => r);

/** The rules `pw` does not meet, in display order; empty when it meets all. */
export function passwordProblems(pw: string): PasswordRule[] {
  return RULES.filter(([, ok]) => !ok(pw)).map(([rule]) => rule);
}
