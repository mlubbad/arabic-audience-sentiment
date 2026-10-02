/** The same documents in English. Section ids match `ar.ts` one for
 *  one — `legal.test.ts` holds the two to that — so an English reader is
 *  bound by the same text as an Arabic one, and a section added to one
 *  language without the other fails a test rather than a reader. */
import type { LegalSet } from "./types";

const GOOGLE_PRIVACY = "https://policies.google.com/privacy";
const YOUTUBE_TERMS = "https://www.youtube.com/t/terms";
const GOOGLE_PERMISSIONS =
  "https://myaccount.google.com/connections?filters=3,4&hl=en";
const GOOGLE_USER_DATA_POLICY =
  "https://developers.google.com/terms/api-services-user-data-policy";
const YOUTUBE_API_TERMS =
  "https://developers.google.com/youtube/terms/api-services-terms-of-service";
const PADDLE_BUYER_TERMS = "https://www.paddle.com/legal/checkout-buyer-terms";
const PADDLE_PRIVACY = "https://www.paddle.com/legal/privacy";
const SUPABASE_PRIVACY = "https://supabase.com/privacy";
const CLOUDFLARE_PRIVACY = "https://www.cloudflare.com/privacypolicy/";
const SKY_DEVELOP = "https://sky-develop.net";
const UPDATED = "2026-09-23";

export const legalEn: LegalSet = {
  privacy: {
    title: "Privacy Policy",
    updated: UPDATED,
    lead: "This policy explains what Audience Sentiment collects about you and your YouTube channel, why, for how long, who it is shared with, and what you can do about it.",
    sections: [
      {
        id: "who",
        heading: "Who we are and how to reach us",
        paragraphs: [
          "Audience Sentiment is a product of [Sky Develop](https://sky-develop.net), offered at app.sky-develop.net. In this policy, “we” and “the service” mean this product and its operator.",
          `For any questions, concerns, or requests regarding this Privacy Policy or your data, or to exercise any of the rights described herein, contact us directly by email at support@sky-develop.net or privacy@sky-develop.net, or through our website at [Sky Develop](${SKY_DEVELOP}).`,
        ],
      },
      {
        id: "scope",
        heading: "What this policy covers",
        paragraphs: [
          "This policy applies to the service's website, application, dashboards and APIs. It does not apply to the sites and services we link to or depend on, such as Google, YouTube and Paddle; each has its own policy, linked in the “Who we share it with” section below.",
          "Some pages show clearly marked synthetic data, which is nobody's personal data.",
        ],
      },
      {
        id: "data",
        heading: "What we collect",
        paragraphs: ["We collect the least the service needs to work, namely:"],
        bullets: [
          "Account data: the email address and account identifier we receive when you sign in (through Google or any other sign-in provider that is enabled), and the time of sign-in. We never see or store your password.",
          "Workspace data: the workspace's name, the plan active on it, who owns it and who may enter it, and how much of its allowance has been used.",
          "Data from the connected YouTube channel: the channel's id and name, public video data (title, publish date, public statistics), and the public comments on those videos: the comment text, the author's display name and id, the time it was posted, its like count, and whether it is a reply. This reaches us from the YouTube Data API after you explicitly authorise it.",
          "The OAuth tokens Google grants for reading your channel. They are stored encrypted, never appear in the browser, and are used for nothing but collecting from your channel.",
          "Billing data: when you subscribe to a paid plan, Paddle creates a customer and subscription record and sends us their identifiers, the subscription's status and the paid period. Your card details never reach us and are not stored by us; Paddle processes the payment.",
          "Technical data: IP address, browser type and request time in server logs and in the Cloudflare network that protects the site, for operation and security only.",
          "What you write inside the service: your corrections to a comment's label, the exports you request, and your interface choices.",
        ],
      },
      {
        id: "use",
        heading: "How we use it",
        paragraphs: [
          "We use and process the data collected above and authorized YouTube API data strictly to provide, maintain, and improve the service, specifically:",
        ],
        bullets: [
          "Collecting your channel's public comments and metadata, and processing them locally on our dedicated secure servers to classify their sentiment (positive, negative, neutral, mixed) using self-hosted open-source Arabic NLP models. No comment or user data is ever sent to external third-party AI providers.",
          "Showing aggregated analytics and sentiment trends in the dashboard, comparing videos, and producing downloadable reports and exports upon request.",
          "Keeping your manual sentiment corrections and displaying updated analytics to you and members who share your workspace.",
          "Metering consumption against the workspace plan's allowance, and activating subscribed features and quotas.",
          "Operating, maintaining, and securing the service, monitoring system performance, and detecting faults, unauthorized access, and abuse.",
        ],
      },
      {
        id: "google",
        heading: "Google and YouTube data",
        paragraphs: [
          `The service uses YouTube API Services. By using it you agree to the [YouTube Terms of Service](${YOUTUBE_TERMS}), and the [Google Privacy Policy](${GOOGLE_PRIVACY}) applies to the data Google processes.`,
          "We ask Google for exactly one permission, youtube.force-ssl, and use it only to read: your channel and its video list, and the public comments and replies on the videos you choose. Google offers no narrower permission that allows reading a channel's comments as its owner, which is why this one is requested. We do not write to your channel, publish, delete, or reply to anyone in your name. We do not use your email to prove channel ownership; the authorisation itself proves it.",
          `Our use of information received from Google APIs, and its transfer to any other app, adheres to the [Google API Services User Data Policy](${GOOGLE_USER_DATA_POLICY}), including its Limited Use requirements. We do not sell this data, do not use it for advertising, and no human reads it except with your explicit consent for technical support or security, or where the law requires it.`,
          "Stored YouTube data is refreshed or deleted within thirty days: the comment text and the author's name and id are permanently erased from our database thirty days after collection by an automated database purge, and only non-identifying aggregated metrics needed for dashboard statistics remain (a content fingerprint, the date, the like count, the sentiment label).",
          `Users can revoke that API Client's access to their data at any time via the Google security settings page at [https://myaccount.google.com/connections?filters=3,4&hl=en](${GOOGLE_PERMISSIONS}). Upon revocation, the service's access is immediately terminated, stored authorization tokens are invalidated, and all automated data collection stops at once.`,
        ],
      },
      {
        id: "retention",
        heading: "Retention and deletion",
        paragraphs: [
          "Procedure for deleting stored YouTube data: Raw YouTube comment text and author identifying data (author name and channel ID) are automatically and permanently deleted from our database thirty days after collection via a scheduled daily purging routine. Non-identifying statistical aggregates (fingerprint, timestamp, like count, sentiment label) are retained to preserve historical dashboard analytics for as long as the workspace remains active.",
          "Procedure for disconnecting a channel and deleting tokens: You can disconnect your YouTube channel at any time from within the workspace settings or revoke access via Google security settings. Disconnecting the channel immediately invalidates and permanently purges stored OAuth access and refresh tokens from our systems, and cancels all scheduled data synchronization.",
          "Procedure for requesting complete data deletion: You can request the complete and permanent deletion of your account, workspace, and all associated stored data at any time by sending an email to support@sky-develop.net or privacy@sky-develop.net. Upon receiving and verifying your request, we permanently delete your account, workspace configuration, and all stored data from our active databases within seven days of the request, keeping only minimal financial transaction records strictly required by tax and legal regulations.",
          "Server logs: for the short period operation and security require, then deleted.",
        ],
      },
      {
        id: "sharing",
        heading: "Who we share it with",
        paragraphs: [
          "We do not sell, rent, trade, or monetize your personal information or YouTube data under any circumstances. User data is processed and shared strictly between internal and external parties as follows:",
          "Internal parties: Access to user and YouTube data within our organization is strictly limited on a need-to-know basis to authorized engineering and technical support personnel solely for system administration, infrastructure maintenance, security monitoring, and resolving user-initiated support requests. All personnel are bound by strict contractual confidentiality obligations. No team member reads user channel comments or data unless expressly requested by the user for technical troubleshooting.",
          "External parties: We share data solely with vetted third-party service providers (data sub-processors) strictly necessary for hosting, infrastructure, payment, and security, under binding data protection commitments, or when legally compelled:",
        ],
        bullets: [
          `Supabase: cloud PostgreSQL database, authentication, and secure backend functions running in the EU ([Supabase privacy policy](${SUPABASE_PRIVACY})).`,
          `Paddle: payment, invoicing and tax; the merchant of record you buy the plan from ([Paddle privacy policy](${PADDLE_PRIVACY})).`,
          `Google / YouTube: the source of your channel's data, and a sign-in provider ([Google Privacy Policy](${GOOGLE_PRIVACY})).`,
          `Cloudflare and the hosting provider: delivering and protecting the site's pages ([Cloudflare privacy policy](${CLOUDFLARE_PRIVACY})).`,
          "We also share data with an authority where the law obliges us to, or to protect our rights or the safety of users.",
        ],
      },
      {
        id: "transfer",
        heading: "International transfers",
        paragraphs: [
          "The providers named above run servers in different countries, so your data may be stored or processed outside the country you live in. We choose providers that offer contractual and technical safeguards, and each provider's policy is linked in the previous section.",
        ],
      },
      {
        id: "security",
        heading: "Security",
        paragraphs: [
          "All traffic is encrypted (HTTPS). Google authorisation tokens are encrypted at rest. Each workspace's data is isolated in the database itself (row-level access policies), so an account outside it cannot reach it even by bypassing the interface. The collection worker proves its identity with a key that is stored only hashed. No system is perfectly secure, however, and we ask you to protect your Google account.",
        ],
      },
      {
        id: "rights",
        heading: "Your rights",
        paragraphs: [
          "You may ask to access your data, correct it, delete it, receive a copy of it, restrict or object to its processing, and withdraw your consent at any time (withdrawal does not affect what was done before it). Exporting results is available to you directly from the dashboard, and disconnecting the channel from inside the service or from your Google security settings. For data deletion requests or other inquiries, contact us directly at support@sky-develop.net or privacy@sky-develop.net; we answer and process requests within a reasonable time not exceeding thirty days. If you are in a region that gives you the right to complain to a data protection authority, that right is yours.",
          "A note for comment authors: the comments we analyse are public on YouTube. If you wrote a comment and want its text or your name removed from the service before its automatic erasure after thirty days, contact us at support@sky-develop.net and we will act.",
        ],
      },
      {
        id: "cookies",
        heading: "Cookies and local storage",
        paragraphs: [
          "We use no third-party analytics, tracking or advertising. The browser stores only two things locally: the interface language you chose and your sign-in session (so you stay signed in). Cloudflare may set a technical cookie to protect against abuse, and Paddle may set its own when the checkout opens; both are described in their respective policies.",
        ],
      },
      {
        id: "children",
        heading: "Minors",
        paragraphs: [
          "The service is for channel owners and teams and is not offered to anyone under eighteen. If we learn that an account was created for a minor we delete it.",
        ],
      },
      {
        id: "changes",
        heading: "Changes to this policy",
        paragraphs: [
          "We may update this policy as the service or the law changes. The date of the last update is at the top of the page, and a material change is announced inside the service or by email before it takes effect.",
        ],
      },
    ],
  },

  terms: {
    title: "Terms of Service",
    updated: UPDATED,
    lead: "These terms are an agreement between you and Audience Sentiment by Sky Develop. By using the service or creating an account you agree to them, and to the privacy policy that accompanies them.",
    sections: [
      {
        id: "service",
        heading: "The service and its status",
        paragraphs: [
          "Audience Sentiment collects the public comments on a YouTube channel you connect, classifies their sentiment automatically, and shows the results in a dashboard you can filter and export.",
          "The service's features may change, a feature may be withdrawn or added, and some pages may show clearly marked synthetic data. We make reasonable efforts to keep it running without guaranteeing uninterrupted availability.",
        ],
      },
      {
        id: "account",
        heading: "Accounts and eligibility",
        paragraphs: [
          "You must be at least eighteen, and the information you provide must be accurate. You are responsible for everything done from your account and from the workspaces you own, and for protecting the means you sign in with. Tell us at once if you suspect unauthorised use.",
          "An account is for one person. A workspace may hold more than one member according to its plan, and the workspace's owner is responsible for whom they add to it.",
        ],
      },
      {
        id: "youtube",
        heading: "Your YouTube channel",
        paragraphs: [
          `The service depends on YouTube API Services. By connecting your channel you confirm that you own it or are authorised to manage it, you agree to the [YouTube Terms of Service](${YOUTUBE_TERMS}), and you acknowledge that the [Google Privacy Policy](${GOOGLE_PRIVACY}) applies to what Google processes.`,
          `We only read from your channel and never write to it, and we do not exceed the permissions you grant. You can disconnect the channel at any time inside the service or on the [permissions page of your Google Account](${GOOGLE_PERMISSIONS}). For our part we comply with the [YouTube API Services Terms of Service](${YOUTUBE_API_TERMS}), including refreshing or deleting stored YouTube data within thirty days.`,
        ],
      },
      {
        id: "acceptable",
        heading: "Acceptable use",
        paragraphs: ["You may not:"],
        bullets: [
          "Connect a channel you neither own nor are authorised to manage, or impersonate someone else.",
          "Use the service to harass, target or identify comment authors, or for any purpose that breaches YouTube's terms or the law.",
          "Attempt to reach a workspace that is not yours, circumvent plan limits or metering, or interfere with the service's operation.",
          "Resell the service or its results as they are, or extract its data automatically outside the export the dashboard offers.",
          "Reverse-engineer the service or its models beyond what the law permits.",
        ],
      },
      {
        id: "plans",
        heading: "Plans and billing",
        paragraphs: [
          `Plans and their prices are shown on the [pricing page](https://app.sky-develop.net/pricing). The merchant of record for every paid plan is Paddle (Paddle.com Market Ltd or the affiliate responsible for your region), which processes the payment, issues the invoice, collects the applicable tax and handles refunds. By buying a plan you also agree to the [Paddle checkout buyer terms](${PADDLE_BUYER_TERMS}).`,
          "The prices shown exclude VAT or sales tax; it is added at checkout according to your country. Subscriptions are monthly or yearly and renew automatically at the end of each period at the price published at that time, unless you cancel before the renewal date.",
          "A plan is activated on one workspace (and on its client workspaces under agency plans). Each plan has published limits (such as the number of channels and the comments analysed per period); when a limit is reached, collection stops until the next period or an upgrade. We never exceed the limit and bill the difference without your request.",
          "If a renewal payment fails, the plan stays active for a seven-day grace period so you can correct the payment method; then the workspace moves to the free plan and keeps its data.",
        ],
      },
      {
        id: "refunds",
        heading: "Cancellation and refunds",
        paragraphs: [
          "You can cancel a subscription at any time from the account page through Paddle's portal. Access to the paid plan continues until the end of the period you paid for unless you choose immediate cancellation; the workspace then moves to the free plan and its data is not deleted.",
          "If you subscribe to a paid plan for the first time and it does not suit you, ask for a refund within fourteen days of the first payment and we refund it in full. Renewal payments are not refunded once the period has begun except where the law requires it (such as consumer withdrawal rights in some countries), and Paddle assesses requests under its own terms. Refund requests are made through the contact channel in the privacy policy or directly through Paddle.",
          "The free plan has no price and nothing to refund, and additional comment packs are not refunded once consumed.",
        ],
      },
      {
        id: "pilot",
        heading: "Founding partners",
        paragraphs: [
          "We may grant a limited number of channels a “founding partner” plan at no charge, in exchange for their feedback on the product. This plan is a grant, not an entitlement, and may be ended or converted to a published plan with reasonable notice.",
        ],
      },
      {
        id: "ai",
        heading: "Automatic classification and its limits",
        paragraphs: [
          "Labels are produced by an automatic language model and are an estimate, not a verdict. It can be wrong about sarcasm, dialects and context; its confidence is shown beside it, and you can correct it. Do not rely on the results alone for a decision that affects a person. The service is an analysis tool, not legal or business advice.",
        ],
      },
      {
        id: "ip",
        heading: "Ownership and content",
        paragraphs: [
          "The service, its design and its software belong to us or our licensors. Comments belong to their authors and are subject to YouTube's terms. You may use the results and exports produced for your workspace for your own purposes within these terms and YouTube's. You grant us a limited licence to process your channel's data as far as needed to provide the service to you.",
        ],
      },
      {
        id: "termination",
        heading: "Termination",
        paragraphs: [
          "You can close your account at any time. We may suspend or terminate an account or workspace for a breach of these terms or YouTube's, to protect the service or its users, or where the law requires it. On termination the retention and deletion rules in the privacy policy apply.",
        ],
      },
      {
        id: "liability",
        heading: "Disclaimer and limitation of liability",
        paragraphs: [
          "The service is provided “as is” and “as available”, without express or implied warranty beyond what the law does not allow to be excluded. We do not guarantee the accuracy of labels or the completeness of collection; what reaches us from YouTube may be incomplete or late, and we report that as a partial collection, never as a success.",
          "To the extent the law allows, we are not liable for indirect or consequential loss, lost profits or lost data, and our total liability for any claim does not exceed what you paid us through Paddle in the twelve months before it. Nothing above limits consumer rights that the law of your country does not allow to be waived.",
        ],
      },
      {
        id: "changes",
        heading: "Changes to these terms",
        paragraphs: [
          "We may amend these terms. The date of the last update is at the top of the page, and a material amendment is announced inside the service or by email a reasonable time before it takes effect. Continuing to use the service after that is acceptance of the amended terms; if you do not accept them, you may close your account.",
        ],
      },
      {
        id: "contact",
        heading: "Contact",
        paragraphs: [
          `For any questions about these terms, contact us directly by email at support@sky-develop.net or through the channels published on the [Sky Develop](${SKY_DEVELOP}) website.`,
        ],
      },
    ],
  },
};
