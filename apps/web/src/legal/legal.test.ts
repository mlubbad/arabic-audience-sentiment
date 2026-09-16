/** The three documents, held to what they claim.
 *
 * Two kinds of check. Parity: an English reader is bound by the same text as
 * an Arabic one, section for section and link for link — a section or a link
 * present in one language and not the other is a document that says two
 * different things depending on who opens it. Fact: the sentences that
 * describe the code point at the things the code actually does — the two
 * scopes, the thirty days, the pages Google requires an API client to link.
 */
import { describe, expect, it } from "vitest";
import { legalAr, legalEn, LEGAL_KEYS, LEGAL_PATHS, inline } from "./index";
import type { LegalDocument } from "./types";

const LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const hrefs = (doc: LegalDocument) =>
  doc.sections.flatMap((s) =>
    [...s.paragraphs, ...(s.bullets ?? [])].flatMap((p) =>
      [...p.matchAll(LINK)].map((m) => m[2]),
    ),
  );
const text = (doc: LegalDocument) =>
  [
    doc.title,
    doc.lead,
    ...doc.sections.flatMap((s) => [
      s.heading,
      ...s.paragraphs,
      ...(s.bullets ?? []),
    ]),
  ].join("\n");

describe("the legal documents", () => {
  it("say the same thing in both languages, section for section", () => {
    for (const key of LEGAL_KEYS) {
      const ar = legalAr[key];
      const en = legalEn[key];
      expect(
        en.sections.map((s) => s.id),
        key,
      ).toEqual(ar.sections.map((s) => s.id));
      expect(en.updated, key).toBe(ar.updated);
      for (const [i, s] of ar.sections.entries()) {
        const other = en.sections[i];
        expect(other.paragraphs.length, `${key}.${s.id} paragraphs`).toBe(
          s.paragraphs.length,
        );
        expect((other.bullets ?? []).length, `${key}.${s.id} bullets`).toBe(
          (s.bullets ?? []).length,
        );
      }
      // The same links, in the same order: a translation cannot drop the
      // page Google requires, or point the reader somewhere else.
      expect(hrefs(en), key).toEqual(hrefs(ar));
    }
  });

  it("carry a real date and no section without an id", () => {
    for (const key of LEGAL_KEYS) {
      const doc = legalAr[key];
      expect(doc.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(doc.updated))).toBe(false);
      const ids = doc.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(/^[a-z]+$/);
    }
  });

  it("link only over https, and to the pages YouTube API clients must link", () => {
    for (const key of LEGAL_KEYS) {
      for (const href of hrefs(legalAr[key]))
        expect(href).toMatch(/^https:\/\//);
    }
    // YouTube API Services terms, III.A: a client's privacy policy links the
    // Google Privacy Policy, and users agree to the YouTube Terms of Service.
    for (const doc of [legalAr.privacy, legalEn.privacy]) {
      const links = hrefs(doc);
      expect(links).toContain("https://policies.google.com/privacy");
      expect(links).toContain("https://www.youtube.com/t/terms");
      expect(links).toContain("https://myaccount.google.com/permissions");
    }
  });

  it("describe the code as it is", () => {
    // The scopes oauth-start asks for, and the retention purge_comment_text runs.
    for (const set of [legalAr, legalEn]) {
      const privacy = text(set.privacy);
      expect(privacy).toContain("youtube.readonly");
      expect(privacy).toContain("youtube.force-ssl");
      expect(privacy).toMatch(/ثلاثين يومًا|thirty days/);
      // Nobody's name or personal mailbox: the contact is the company site.
      expect(
        text(set.privacy) + text(set.terms) + text(set.thirdParty),
      ).not.toMatch(/@gmail\.com|لُبّد|Lubbad/);
    }
    // The page a document is linked at is the page it is served at.
    expect(LEGAL_PATHS.privacy).toBe("/privacy-policy");
  });
});

describe("inline links", () => {
  it("split a paragraph into text and anchors, in order", () => {
    expect(
      inline("see [Google](https://g.co/a) and [B](https://b.io)."),
    ).toEqual([
      "see ",
      { label: "Google", href: "https://g.co/a" },
      " and ",
      { label: "B", href: "https://b.io" },
      ".",
    ]);
  });
  it("leave a plain paragraph as one run and refuse a non-http link", () => {
    expect(inline("plain")).toEqual(["plain"]);
    expect(inline("[x](javascript:alert(1))")).toEqual([
      "[x](javascript:alert(1))",
    ]);
  });
});
