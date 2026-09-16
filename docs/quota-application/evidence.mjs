// Assembles docs/quota-application/evidence/*.png into one PDF for the form's
// single evidence upload: a page per screenshot with the URL it was taken at,
// the date and what it shows — a caption, not a drawn browser chrome. Two
// Google-hosted screens are left as labelled slots until the owner captures
// them (see docs/youtube-quota-extension.md §3).
// Run from the repository root: node docs/quota-application/evidence.mjs
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";

const dir = "docs/quota-application/evidence";
const pages = [
  { file: "01-oauth-consent.png", url: "accounts.google.com — consent screen", what: "(a) OAuth flow: Google's consent screen naming the API client 'Audience Sentiment' and the two scopes (youtube.readonly, youtube.force-ssl).", who: "captured by the owner in their own Google session" },
  { file: "02-account-connected-disconnect.png", url: "https://app.sky-develop.net/account", what: "(a) OAuth flow — revocation inside the application: the connected channel (AJ360) with the 'disconnect channel' question open; confirming revokes the stored grant and cancels scheduled reads. Also visible: a retired workspace and the rename door." },
  { file: "03-google-permissions.png", url: "https://myaccount.google.com/permissions", what: "(a) OAuth flow — revocation at Google: 'Audience Sentiment' listed under third-party access; removing it makes the next API call fail with invalid_grant and the application marks the channel for reconnection.", who: "captured by the owner in their own Google session" },
  { file: "04-catalogue-comment-counts.png", url: "https://app.sky-develop.net/sync", what: "(d) Dashboard — the catalogue: 4,459 uploads with YouTube's reported comment counts, the owner's selection, and the plan budget line. Selection precedes any comment read." },
  { file: "05-dashboard-summary.png", url: "https://app.sky-develop.net/dashboard", what: "(d) Dashboard — sentiment and topic overview for the selected videos; YouTube data shown as YouTube's, our classification shown as ours." },
  { file: "06-comments-table-labels.png", url: "https://app.sky-develop.net/dashboard#comments", what: "(d) Dashboard — the comments themselves with the model's sentiment label and confidence on each; sort by likes, date, or negative." },
];
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  @page{size:A4 landscape;margin:12mm}
  body{font-family:"Helvetica Neue",Arial,sans-serif;color:#1c1b2e;margin:0}
  .pg{page-break-after:always;height:180mm}
  .hd{font-size:11pt;line-height:1.4;margin:0 0 6pt}
  .hd b{color:#3b27ba}.url{font-family:Menlo,monospace;font-size:10pt;color:#b3261e}
  img{width:100%;max-height:150mm;object-fit:contain;border:1px solid #cfcde3}
  .slot{height:150mm;border:2px dashed #b3261e;display:flex;align-items:center;justify-content:center;color:#b3261e;font-size:14pt;text-align:center;padding:20mm;box-sizing:border-box}
  .cover h1{font-size:22pt;margin:0 0 6pt}.cover p{font-size:12pt}
</style></head><body>
<div class="pg cover"><h1>Audience Sentiment — evidence for Project #1</h1>
<p>API client: <b>Audience Sentiment</b> · https://app.sky-develop.net · Google Cloud project 272573239614 · prepared 2026-09-16.</p>
<p>Conditional evidence supplied: <b>(a) OAuth flow</b> (consent screen, scopes, revocation) and <b>(d) Dashboard / feature screenshots</b> (Analytics &amp; Reporting). (b) and (c) do not apply: the application neither uploads nor embeds a player.</p>
<p>Each page states the URL it was captured at and what it shows. In-app pages were captured from the production preview on 2026-09-16 while signed in as the channel owner (the interface is Arabic-first; an English interface is one switch away).</p></div>
${pages.map((p) => {
  const path = `${dir}/${p.file}`;
  const body = existsSync(path)
    ? `<img src="data:image/png;base64,${readFileSync(path).toString("base64")}">`
    : `<div class="slot">Slot for ${esc(p.file)} — ${esc(p.who ?? "")}. Add the file to ${dir}/ and re-run evidence.mjs.</div>`;
  return `<div class="pg"><p class="hd"><b>${esc(p.file)}</b> · <span class="url">${esc(p.url)}</span> · 2026-09-16<br>${esc(p.what)}</p>${body}</div>`;
}).join("")}
</body></html>`;
const b = await chromium.launch();
const pg = await b.newPage();
await pg.setContent(html, { waitUntil: "load" });
await pg.pdf({ path: "docs/quota-application/evidence-project-1.pdf", format: "A4", landscape: true, printBackground: true });
await b.close();
console.log("wrote docs/quota-application/evidence-project-1.pdf");
