/** The shape of a legal document, in either language.
 *
 * Kept apart from `strings/` on purpose. Those are sentences the product
 * says while it works and every reader needs them; these are three long
 * documents a reader opens once, if at all, so they load with the page that
 * shows them and not with the shell. The `Loosen` contract in `strings/ar.ts`
 * also admits no nested objects, and a document is nothing but nesting.
 *
 * A paragraph may carry a link written as `[label](https://…)`; `inline()`
 * turns it into an anchor. Nothing else is markup — a document that needs
 * more than a paragraph, a list and a link needs a designer, not a parser.
 */
export type LegalSection = {
  /** Stable across languages: the `id` an anchor points at, and what the
   *  parity test matches an Arabic section to its English one by. */
  id: string;
  heading: string;
  paragraphs: readonly string[];
  bullets?: readonly string[];
};

export type LegalDocument = {
  title: string;
  /** ISO date, the day this text took effect. */
  updated: string;
  lead: string;
  sections: readonly LegalSection[];
};

export type LegalKey = "privacy" | "terms";
export type LegalSet = Readonly<Record<LegalKey, LegalDocument>>;

/** Where each document lives. The landing footer, the app footer and the
 *  routes all read this one table, so a document cannot be linked to an
 *  address that is not served, or served at one nothing links to. */
export const LEGAL_PATHS: Readonly<Record<LegalKey, string>> = {
  privacy: "/privacy-policy",
  terms: "/terms",
};

export const LEGAL_KEYS: readonly LegalKey[] = ["privacy", "terms"];
