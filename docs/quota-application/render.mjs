// Renders the quota-application diagrams to PNG and the supporting document
// to PDF. Run from the repository root: `node docs/quota-application/render.mjs`.
import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const dir = `file://${process.cwd()}/docs/quota-application`;
for (const n of ["architecture", "user-flow"]) {
  await p.goto(`${dir}/${n}.html`);
  await p.screenshot({ path: `docs/quota-application/${n}-diagram.png` });
}
await p.goto(`${dir}/supporting-materials.html`);
await p.pdf({ path: "docs/quota-application/supporting-materials.pdf", format: "A4", printBackground: true });
await b.close();
