/** The English translation. Typed against the Arabic, so a missing line is a
 *  type error, not a key name on screen. See `ar.ts` for the rules. */
import type { Strings } from "./ar";

export const en: Strings = {
  brand: "Audience Sentiment",
  brandOwner: "by Sky Develop",
  brandHomeLabel: "Audience Sentiment — home",
  skipToContent: "Skip to content",
  announcementLead: "Your audience's voice, more clearly",
  announcementTag: "Private preview · beta",
  menuLabel: "App menu",
  menuOpen: "Menu ☰",
  menuClose: "Close ×",
  navLabel: "Main navigation",
  navCaption: "Navigate",
  navOverview: "Overview",
  navOperations: "Operations",
  navAccount: "Sources & account",
  titleOverview: "Overview",
  titleOperations: "Sync status",
  titleAccount: "Account & workspaces",
  titleConnected: "Channel connection result",
  titleNotFound: "Page not found",
  pageOpening: "Opening the page…",
  footerTagline: "From comments to a clearer picture.",
  footerNote:
    "Private preview · some pages use synthetic data, and say so plainly.",
  notFoundEyebrow: "This page is not available",
  notFoundTitle: "We could not find the page you were looking for.",
  notFoundLead: "Go back to the dashboard, or start from the home page.",
  openDashboard: "Open the dashboard",
  backHome: "Back to home",
  signIn: "Sign in",
  yourAccount: "Your account",
  signOut: "Sign out",
  signingOut: "Signing out…",
  signOutFailed: "Could not sign out",
  switchToOther: "العربية",
  switchLabel: "Change interface language",

  authInvalidCredentials:
    "The email or password is incorrect, or there is no account for this email. To create one, choose “Create account”.",
  authEmailNotConfirmed:
    "This account has not been activated yet. Open the confirmation link sent to your email, then sign in.",
  authUserExists:
    "This email is already registered. Choose “Sign in” instead of creating an account.",
  authWeakPassword: "The password is too weak. Use at least eight characters.",
  authEmailInvalid: "That does not look like a valid email address.",
  authEmailNotAuthorized:
    "This email is not allowed to register on this project.",
  authSignupDisabled: "Account creation is switched off on this project.",
  authEmailRateLimit:
    "Too many emails were sent in a short time. Wait a few minutes and try again.",
  authRequestRateLimit:
    "Too many attempts in a short time. Wait a moment and try again.",
  authValidationFailed: "The details entered are incomplete or invalid.",
  authUnknownError: (code: string) =>
    `The request could not be completed. Error code: ${code}`,
  authSignedIn: "Signed in.",
  authSignedUp:
    "Account created. Open the confirmation link sent to your email to activate it, then sign in.",
  providerClosedGoogle:
    "Sign-in with Google is not enabled on this project yet.",
  providerClosedAzure:
    "Sign-in with Microsoft is not enabled on this project yet.",
  providerClosedSso: "Enterprise single sign-on (SAML) is not enabled yet.",

  connectUnauthenticated: "Sign in first to connect a channel.",
  connectForbidden:
    "You do not have permission to connect a channel in this workspace.",
  connectInvalidClient: "This workspace has no client. Create a new workspace.",
  connectNotConfigured: "YouTube connection is not configured on this server.",
  connectInvalidRequest: "The request is missing data.",
  connectUnknownError: (code: string) =>
    `Could not start the connection. Error code: ${code}`,
  serviceUnreachable: "Could not reach the service. Try again.",

  stepWorkspace: "Create your account and your workspace.",
  stepChannel: "Connect a YouTube channel after granting permission.",
  stepCollect:
    "Request a collection, then follow its status and results on the dashboard.",
  stepChannelSeeded:
    "The channel is registered without permission yet; connect it to confirm ownership.",
  stepChannelLapsed:
    "The channel needs reconnecting; the previous permission is no longer valid.",
  stepCollectPending:
    "The request is standing; progress is on the operations page.",
  stepCollectFailed:
    "The last attempt did not complete; the reason is on the operations page.",
  stepStateDone: "Done",
  stepStateNext: "Next step",
  stepStateLater: "Later",
  stepStatePending: "In progress",
  stepStateAttention: "Needs your attention",
  stepsLabel: "Setup steps",
  channelConnected: "Connected channel: ",
  channelSeeded: "Public channel, no permission yet: ",
  channelNeedsRelink: (status: string) =>
    `The channel needs reconnecting (${status}): `,
  channelIdLabel: "ID",
  channelNone: "No channel connected yet",
  requestSync: "Request a sync",
  connectChannel: "Connect a YouTube channel",
  relinkForName: "Reconnect to store the channel's name",

  gateResolvingAccount: "Identifying your account…",
  gateLoadingWorkspaces: "Loading workspaces…",
  gateWorkspacesFailedTitle: "Your workspaces could not be read.",
  gateWorkspacesFailedLead:
    "Refresh the page to try again; demo data cannot be shown in place of your account's.",
  gateNoWorkspaceTitle: "This account has no workspace yet.",
  gateCreateFromAccount: "Create a workspace from the account page",
  workspaceLabel: "Workspace",
  choosePlaceholder: "— choose —",
  changeWorkspace: "Change workspace",
  gateOverviewEyebrow: "Overview",
  gateOverviewTitle: "Which workspace's comments do you want to read?",
  gateOverviewLead:
    "Each workspace has its own channel and comments; one workspace's data is never shown inside another.",
  gateOperationsEyebrow: "Collection status",
  gateOperationsTitle: "Which workspace's operations do you want to follow?",
  gateOperationsLead:
    "Each workspace has its own collection status, plan limits and attempt log.",

  planNoneChosenKicker: "No workspace chosen",
  planNoneChosenTitle: "Limits are per workspace",
  planNoneChosenNote: "Choose a workspace to see what is left of its plan.",
  planKickerFallback: "Workspace",
  planLoading: "Reading the plan…",
  planFailedTitle: "The plan could not be read",
  planFailedNote:
    "That does not mean the limit is reached. Refresh the page to try again.",
  planNoneTitle: "No active plan",
  planNoneNote: "The operator activates plans manually at this stage.",
  planTitle: (key: string) => `${key} plan`,
  planExhausted: (name: string, allowance: string) =>
    `${name}: limit reached (${allowance})`,
  planRemaining: (name: string, remaining: string, allowance: string) =>
    `${name}: ${remaining} of ${allowance} left`,
  budgetAnalysis: "Comment analysis",
  budgetBackfill: "Historical backfill",

  working: "Working…",
  ssoNeedsDomain:
    "Single sign-on needs your organisation's domain — that screen is not built yet.",
  providerStartFailed: "Could not start sign-in with this provider.",
  sessionReadFailed: "The account session could not be read",
  workspacesLoadFailed: "Workspaces could not be loaded",
  accountEyebrow: "Account",
  accountTitle: "Account & workspaces",
  accountLead:
    "Your workspaces, their channels, and where each one is in setup.",
  accountUnavailableTitle: "Sign-in is not available in this preview",
  accountUnavailableLead:
    "A development project URL and a publishable key are needed to enable accounts. Test data is never used as a session.",
  accountTryDashboardTitle: "Start with the dashboard demo",
  accountTryDashboardLead:
    "Explore the interface with synthetic data that says what it is.",
  createWorkspaceFailed: "The workspace could not be created",
  createWorkspaceListFailed: "Created, but the list could not be refreshed",
  createWorkspaceDone: "Workspace created",
  authJoinTitle: "Create your account",
  authReturnTitle: "Welcome back",
  authJoinLead: "Private preview — an account opens one workspace of your own.",
  authReturnLead: "Go to your workspace, channels and reports.",
  emailLabel: "Email",
  passwordLabel: "Password",
  createAccount: "Create a new account",
  orJoinWith: "or create an account with",
  orSignInWith: "or sign in with",
  haveAccount: "Already have an account?",
  noAccount: "No account yet?",
  joinLink: "Create one",
  howToStartEyebrow: "How to start",
  howToStartTitle: "From your channel to a clearer reading.",
  howToStartLead:
    "Three steps separate your account from a dashboard that reflects what was actually collected.",
  trustTitle: "What this build guarantees",
  trustIsolationStrong: "Your workspace cannot be read from another.",
  trustIsolation:
    " Isolation is enforced in the database itself, and tested with direct requests, not by hiding buttons.",
  trustCountedStrong: "Numbers are counted, not estimated.",
  trustCounted:
    " Every figure is computed from stored rows; what is unknown is called “unknown”, never counted as zero.",
  trustMeasuredStrong: "The model is measured, not claimed.",
  trustMeasured:
    " Six Arabic classifiers were measured against a hand-labelled set, and the results are published in the repository — including that none of them passed the accuracy gate.",
  trustReviewStrong: "Your correction overrides the model.",
  trustReview:
    " A human review replaces the model's prediction for that text, and is kept with its author and reason.",
  trustNote:
    "Private preview. No customer counts, no logos: there is nothing to count yet, and an invented number at the door undoes what the dashboard says behind it.",
  insideAccount: "You are signed in. Choose the workspace you want to manage.",
  workspacesTitle: "Workspaces",
  workspacesLead:
    "Each workspace owns its channel, its data and its limits. One workspace's data is never shown inside another.",
  noWorkspaceStrong: "No workspace available",
  noWorkspaceLead: "Create one below to begin.",
  syncRequestFailed: "The sync request could not be registered.",
  syncRequestStanding:
    "A sync request is standing. Each channel has one request at a time, and it will not start until a collector is running — details on the “Sync status” page.",
  anotherWorkspaceTitle: "Another workspace for a client or channel",
  anotherWorkspaceLead:
    "Each workspace keeps its own audience, data and permissions.",
  workspaceNameLabel: "Workspace name",
  createWorkspace: "Create workspace",
};
