// Renders the OAuth-branding logo — the landing page's own four-bar mark
// (apps/web/src/BrandMark.tsx, colors and proportions from apps/web/src/landing.css
// .lp-mark / .lp-mark i), scaled to a square PNG with margin so the -10deg
// rotation never clips at the frame. Run from the repository root:
//   node docs/oauth-verification-assets/render-logo.mjs
import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 512, height: 512 } });
await p.goto(`file://${process.cwd()}/docs/oauth-verification-assets/logo.html`);
await p.screenshot({
  path: "docs/oauth-verification-assets/audience-sentiment-logo.png",
  omitBackground: true,
});
await b.close();
console.log("wrote docs/oauth-verification-assets/audience-sentiment-logo.png");
