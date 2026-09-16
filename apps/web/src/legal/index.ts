export * from "./types";
export { inline, type Run } from "./inline";
export { legalAr } from "./ar";
export { legalEn } from "./en";
import type { Locale } from "../locale";
import type { LegalSet } from "./types";
import { legalAr } from "./ar";
import { legalEn } from "./en";

export const legalFor = (locale: Locale): LegalSet =>
  locale === "en" ? legalEn : legalAr;
