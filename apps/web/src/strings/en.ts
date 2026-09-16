/** The English translation. Typed against the Arabic, so a missing line is a
 *  type error, not a key name on screen. See `ar.ts` for the rules. */
import type { Strings } from "./ar";

/** English counts. The number arrives already formatted ("1,234"), so the
 *  test is on the string; one is the only count that changes the noun. */
const one = (n: string | number) => String(n) === "1";
const pl = (n: string | number, singular: string, plural: string) =>
  one(n) ? singular : plural;

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
  railWorkspaceCaption: "Workspace",
  railWorkspaceNone: "No workspace chosen yet",
  railCollectionCaption: "Collection",
  railCollectionReading: "Reading collection state…",
  railCollectionUnavailable: "Collection state could not be read",
  navOverview: "Overview",
  navOperations: "Operations",
  navAccount: "Sources & account",
  navAdmin: "Admin",
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
    "Choose the videos to collect, then follow their status on the operations page.",
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
  disconnectChannel: "Disconnect channel",
  disconnectConfirm:
    "Collection stops and access to the channel is revoked. What was collected stays. Disconnect it?",
  disconnectKeep: "Keep it connected",
  disconnectDone:
    "The channel is disconnected; nothing is read until it is linked again.",
  disconnectFailed: "The channel could not be disconnected.",
  renameWorkspace: "Rename",
  renameSave: "Save name",
  renameCancel: "Cancel",
  renameDone: "The name is changed.",
  renameFailed: "The name could not be changed.",
  retireWorkspace: "Retire workspace",
  retireConfirm:
    "Your access to this workspace ends, its channel is disconnected, and everything collected in it passes to the service operator — nothing is deleted. To have your data deleted, email us. Retire it?",
  retireKeep: "Keep it",
  retireDone:
    "The workspace is retired and now belongs to the service operator.",
  retireLast: "Your last workspace cannot be retired; create another first.",
  retireFailed: "The workspace could not be retired.",
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
  planExhausted: (name: string, allowance: string) =>
    `${name}: limit reached (${allowance})`,
  planRemaining: (name: string, remaining: string, allowance: string) =>
    `${name}: ${remaining} of ${allowance} left`,
  budgetAnalysis: "Comment analysis",
  budgetBackfill: "Historical backfill",
  budgetTopics: "Topic classification",

  planPanelTitle: "Your plan",
  planStatusPastDue: "Payment is overdue",
  planStatusEnding: "Will not renew",
  planOpenEnded: "No end date",
  planRenews: (date: string) => `Renews on ${date}`,
  planPastDue: (date: string) =>
    `The payment could not be collected. The plan stays until ${date}, then the workspace moves to the free plan.`,
  planEndsOn: (date: string) =>
    `Renewal is cancelled; the plan ends on ${date}.`,
  planUsedOf: (used: string, allowance: string) => `${used} of ${allowance}`,
  planUsedUnlimited: (used: string, unlimited: string) =>
    `${used} used · ${unlimited.toLowerCase()}`,
  planUpgrade: "Upgrade the plan",
  planManage: "Manage the subscription",
  planTopup: "Add 10,000 comments",
  planContact: "Contact sales",

  pricingTitle: "Pricing",
  pricingLead:
    "Prices in US dollars, no complexity: monthly, or yearly for roughly two months off.",
  pricingSegmentIndividual: "Individuals & creators",
  pricingSegmentBusiness: "Agencies & businesses",
  pricingMonthly: "Monthly",
  pricingYearly: "Yearly",
  pricingPerMonth: "per month",
  pricingPerMonthBilledYearly: (total: string) => `billed ${total} yearly`,
  pricingMostChosen: "Most chosen",
  pricingCtaStart: "Start now",
  pricingCtaContact: "Contact us",
  pricingCtaFree: "Start free",
  pricingCtaCurrent: "Your current plan",
  pricingLimitComments: "Analyzed comments/month",
  pricingLimitTopics: "Topics/month",
  pricingLimitReports: "Reports/month",
  pricingLimitChannels: "Channels",
  pricingLimitMembers: "Members",
  pricingLimitWorkspaces: "Workspaces (clients)",
  pricingLimitLive: (hours: string) => `Live check every ${hours}h`,
  pricingPriceQuoted: "Custom",
  pricingUnlimited: "Unlimited",
  pricingFaqTitle: "Frequently asked questions",
  pricingFaqNoDouble:
    "Live video doesn't cost twice: only new comments are counted.",
  pricingFaqHardStop: "Analysis stops at the limit; no surprise bill.",
  pricingFaqPack:
    "A 10,000-comment pack for $5 adds on top of your plan's allowance, valid through the end of the period plus a month after.",
  checkoutUnavailable: "Checkout is not available yet",
  portalNoCustomer: "This workspace has no Paddle subscription yet",
  pricingLoading: "Reading the plans…",
  pricingUnavailable:
    "The plans could not be read. Refresh the page to try again.",
  pricingFaqTax:
    "Prices in US dollars are before tax; your country's tax is collected at checkout via Paddle, our merchant of record.",

  adminEyebrow: "Operator",
  adminTitle: "Platform admin",
  adminLead:
    "Every workspace and its plan, and the two hand levers: set a plan, grant a pack.",
  adminForbidden: "This page is for platform operators only.",
  adminLoading: "Reading the workspaces…",
  adminEmpty: "No workspaces yet.",
  adminNoPlan: "No plan",
  adminPlan: "Plan",
  adminStatus: "Status",
  adminPeriodEnd: "Period end",
  adminProvider: "Provider",
  adminMonths: "Months",
  adminNote: "Note",
  adminKind: "Kind",
  adminUnits: "Units",
  adminSetPlan: "Set plan",
  adminGrantPack: "Grant pack",
  adminOverride: "Override the active Paddle subscription",
  adminPaddleActive:
    "This workspace has an active Paddle subscription; enable override to change it",
  adminDone: "Applied.",
  adminFailed: (code: string) => `Could not apply: ${code}`,

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
  anotherWorkspaceTitle: "Another workspace for a client or channel",
  anotherWorkspaceLead:
    "Each workspace keeps its own audience, data and permissions.",
  workspaceNameLabel: "Workspace name",
  createWorkspace: "Create workspace",

  labels: {
    positive: "Positive",
    negative: "Negative",
    neutral: "Neutral",
    mixed: "Mixed",
  },
  budgetMessages: {
    ok: "Within the limit",
    warning: "Usage is approaching the limit",
    critical: "Usage is nearly exhausted",
    exhausted:
      "Limit reached; no new batches will be analysed until the plan is raised or a new period begins",
  },
  reviewStateMessages: {
    in_force: "In force: this is the result currently in effect",
    superseded_by_review: "Superseded by a newer review",
    superseded_by_edit:
      "No longer applies after the text changed; needs re-checking",
    legacy_unverified: "Legacy, unverified edit; not counted as a human review",
  },
  syncMessages: {
    healthy: "The last sync completed recently",
    running: "A sync is running now; the outcome is not known yet",
    stale: "It has been a long time since the last sync; the data may be old",
    partial:
      "The last sync stopped before its end; coverage is partial, not complete",
    incomplete_coverage:
      "The source ended without proving full coverage; that does not mean every comment was collected",
    failed: "The last sync failed",
    blocked: "The source could not be reached in the last sync",
    stalled:
      "Jobs are waiting and collection is stopped — nothing is running to take them",
    never_run: "No sync has run yet",
    never_run_no_worker:
      "No sync has run yet, and collection is stopped right now",
    no_data: "No data about the sync status is available",
  },
  syncErrorMessages: {
    source_access_denied:
      "The source refused access, usually quota or permissions",
    source_unavailable: "The source is temporarily unavailable",
    source_http_error: "The source answered with an unexpected error",
    invalid_response: "An invalid response arrived from the source",
    network_failure: "The source could not be reached",
    source_ended_without_completion:
      "The source ended before collection completed",
    repeated_page_token:
      "A page token repeated, so collection stopped to avoid an endless loop",
    retry_exhausted: "The allowed attempts were used up",
  },
  unknownDate: "Unknown date",
  fixtureVideo: (n: string) => `Synthetic video ${n}`,
  purgedText: "[Text removed after the retention period]",
  purgedAuthor: "[Not retained]",
  weekdays: [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ],

  jobCommentsDisabled:
    "Comments are disabled on this video. There is nothing to collect from it, and that is a setting on the video itself, not a fault in the tool.",
  jobNoUploadHasComments: "None of the videos checked has any comments yet.",
  jobNoUploadHasCommentsCounted: (checked: string, disabled: number) =>
    `${checked} of the latest videos were checked, and none has a comment yet.${
      disabled > 0
        ? ` ${disabled} of them have comments turned off.`
        : " None of them has comments turned off — the channel is simply quiet."
    } The tool is working; there is nothing to read.`,
  jobNoVideo: "No video suitable for collection was found on this channel.",
  jobChannelNotConnected:
    "No channel is connected to this job. Connect a YouTube channel first.",
  jobCredentialExpired:
    "The granted permission has expired. Reconnect the channel to renew it.",
  jobQuotaExceeded:
    "The daily YouTube quota is used up. It renews automatically, and the attempt is retried afterwards.",
  jobKindTopics: "Topic classification",
  jobNoTopicClassifier:
    "The worker has no topic classifier configured. Add the Gemini key to the worker's settings for classification to run.",
  jobTopicModelNotActive:
    "The topic model the worker runs is not this workspace's active one, so nothing was classified.",
  jobGeminiRateLimited:
    "Gemini paused requests for exceeding its limit. It will be retried.",
  jobGeminiUnavailable: "Gemini did not respond. It will be retried.",
  jobGeminiBadResponse:
    "Gemini answered in an unexpected shape for some comments; they will be retried.",
  jobGeminiRefused:
    "Gemini refused the request. Check the Gemini key and its restrictions in the worker's settings.",
  jobInsufficientPermissions:
    "The granted permission is not enough to read comments. Reconnect the channel to renew the scope.",
  jobAccessDeniedWith: (reason: string) =>
    `YouTube refused access (${reason}).`,
  jobSuperseded:
    "Cancelled because an identical request was already in the queue. One request per channel at a time.",
  jobRetryExhaustedNoReason:
    "The limit was reached without any worker recording a reason. This is not a collection failure: it is what a job taken from a worker that was still running looks like. Check the lease duration before restarting the worker.",
  jobRetryExhausted: (why: string) =>
    `The allowed limit was reached. Last reason a worker recorded: ${why}`,
  jobLeaseThrashing: (times: string) =>
    `This job changed hands ${times} times without finishing. It is not slow; nothing can hold on to it — check the worker itself, not the lease duration.`,
  jobLeaseThrashingRepeatedly: "repeatedly",
  jobUnexplainedCode: (code: string) => `Unexplained code: ${code}`,
  jobNoReason: "No reason was recorded.",
  jobQueuedHeadline: "Waiting",
  jobQueuedWithWorker: "In the queue; collection has not started on it yet.",
  jobQueuedNoWorker:
    "In the queue, and collection is stopped right now — nothing is running. It will not start until it resumes.",
  jobRunningHeadline: "In progress",
  jobRunningDetail: "Collection is working on this job now.",
  jobSucceededHeadline: "Completed",
  jobSucceededDetail:
    "The job ran to its end. What arrived is counted on the dashboard, and may be zero if there were no comments.",
  jobPartialHeadline: "Partially completed",
  jobPartialDetail:
    "It stopped before exhausting the source: what was found is saved, and the rest was not read.",
  jobFailedHeadline: "Failed",
  jobBlockedHeadline: "Blocked",
  jobCancelledHeadline: "Cancelled",

  crDeclined:
    "Permission was not granted, so nothing was connected and no token was stored. You can try again whenever you like.",
  crApiNotEnabled:
    "The YouTube Data API v3 is not enabled in your Google Cloud project. Enable it and try again; the consent you just gave is not enough on its own.",
  crScopeMissing:
    "The permission granted does not include reading YouTube data. Try again and accept the full request.",
  crQuotaExceeded:
    "The daily YouTube quota is used up. It returns tomorrow; try again then.",
  crNoChannel:
    "There is no YouTube channel on this account. Sign in with the Google account that owns the channel.",
  crAmbiguousChannel:
    "This account owns more than one channel, and we do not choose for you. Pick a single-channel account.",
  crNoRefreshToken:
    "Google did not grant a renewable permission, and collection needs one to continue after the browser closes. Try again and accept the full request.",
  crInvalidState:
    "The connection request expired or was already used. Start again; that restriction is what stops an old link being reused.",
  crInvalidCallback:
    "The link you returned with is incomplete. Start the connection again.",
  crAlreadyConnected:
    "This channel is connected to another workspace. Disconnect it there first.",
  crConnectedHeading: "Channel connected",
  crConnectedDetail:
    "The channel is connected now. Collection starts with the first sync.",
  crConnectedDetailWith: (channel: string) =>
    `The channel is connected now. Collection starts with the first sync (${channel}).`,
  crIncompleteHeading: "The connection was not completed",
  crFailedHeading: "The connection could not be completed",
  crUnknownDetail: (code: string) =>
    `The request could not be completed. Error code: ${code}`,
  connectedEyebrow: "Connecting a YouTube channel",
  enableApiLink: "Open the YouTube Data API activation page",
  backToAccount: "Back to the account",

  dsNoRun: "No collection has been recorded for this workspace yet.",
  dsCounted: (comments: string, videos: string) =>
    `${comments} ${pl(comments, "comment", "comments")} from ${videos} ${pl(videos, "video", "videos")}`,
  dsCoverageComplete: (counted: string) =>
    `${counted}. The source was read to its end in the last collection.`,
  dsCoveragePartial: (counted: string) =>
    `${counted}. The source was not read to its end, so coverage is partial.`,
  dsNoPreviousRun: "There is no previous collection.",
  dsHealthUnknown: "The collection status is unknown.",
  dsUpdatedUnderHour: "Last updated less than an hour ago.",
  dsUpdatedHours: (hours: string) =>
    `Last updated ${hours} ${pl(hours, "hour", "hours")} ago.`,
  dsFixtureBadge: "Synthetic data",
  dsFixtureScope: "A demo workspace, not connected to any channel",
  dsFixtureReading: "Reading the test data.",
  dsFixtureCoverage: (total: string) =>
    `${total} ${pl(total, "comment", "comments")} written for testing. They represent no real audience.`,
  dsReviewsPersist: "Corrections are saved.",
  dsReviewsSessionOnly:
    "Corrections stay in this session only and are not sent to any server.",
  dsLiveBadge: "Live data",
  dsWorkspaceById: (id: string) => `Workspace ${id}`,
  dsReadingLive: "Reading the data.",
  dsReviewsLogged:
    "Corrections are saved to the review log and cannot be edited once saved.",
  dsReviewsNotSaved: "Corrections are not saved.",

  opsEyebrow: "Operations",
  opsTitle: "Collection and analysis status",
  opsSignedOutLead:
    "This page follows your channel's operation: collection activity, your plan's limits, and a log of every attempt and its reason. All of it belongs to an account and a channel connected to it, so there is nothing to follow before signing in.",
  opsSignInOrJoin: "Sign in or create an account",
  opsSeeDemo: "See what this page looks like",
  opsLead:
    "What you see here describes the service's operation; the audience's comments and their reading are on the dashboard.",
  opsDemoTag: "demo preview",
  opsWorkspaceData: "Operations data for workspace",
  opsDemoNote:
    "Synthetic operations data for the demo, not connected to a real channel.",
  opsReading: "Reading the operations status…",
  opsReadFailed: "The operations status could not be read.",
  retry: "Try again",
  opsHealthTitle: "Sync health",
  opsUnclassifiedFailure: "The sync failed for an unclassified reason",
  opsQueued: (n: number) => `${pl(n, "Job", "Jobs")} waiting: ${n}`,
  opsWorkerLabel: "Collection:",
  opsWorkerConnected: (heartbeat: string) =>
    `running, last sign of life ${heartbeat}`,
  opsWorkerDisconnected:
    "stopped right now — nothing is running. Data will not refresh until it resumes.",
  opsNoChannelBefore: "No channel is connected to this workspace.",
  opsNoChannelLink: "Connect a channel from the account page",
  opsNoChannelAfter: "to start collecting.",
  opsLastRun: (at: string, source: string, videos: number, comments: number) =>
    `Last run: ${at} — source ${source} — videos ${videos}, comments ${comments}.`,
  opsTraversalComplete: "The source was traversed completely.",
  opsTraversalUnproven: "Full traversal of the source was not proven.",
  opsNoPreviousRun: "No previous run is recorded.",
  opsPlanTitle: "Plan limits",
  opsNoPlanStrong: "No plan is active for this workspace",
  opsNoPlanLead:
    "The operator activates plans manually at this stage; this does not mean the limit is reached.",
  opsPlanPeriod: (key: string, from: string, to: string) =>
    `${key} plan — period from ${from} to ${to}, UTC.`,
  opsBudgetLine: (used: number, allowance: number, remaining: number) =>
    `${used} of ${allowance} — ${remaining} left`,
  opsShare: (share: number, message: string) => `${share}% — ${message}`,
  opsAttemptsTitle: "Attempt log",
  opsAttemptsLead:
    "Every collection attempt, newest first, with the reason for what happened.",
  opsDemoNoLogStrong: "The demo carries no job log",
  opsDemoNoLogLead:
    "Jobs belong to a real account and a connected channel. No invented log is shown here to make the place look full.",
  opsLogFailedStrong: "The job log could not be read",
  opsLogFailedLead: "That does not mean it is empty.",
  opsLogReading: "Reading the attempt log…",
  opsNoAttemptsStrong: "No attempts yet",
  opsNoAttemptsLead: "Choose videos from the catalogue above to start one.",
  opsAttemptN: (n: number) => ` · attempt ${n}`,
  opsCancel: "Withdraw from the queue",
  refresh: "Refresh",
  opsCancelFailed:
    "The job could not be withdrawn — a worker may have started it already.",
  opsRetryFailed: "The retry could not be registered.",
  opsCancelled: "The job was withdrawn from the queue.",
  opsRetried:
    "A new attempt was added; it resumes where the previous one stopped.",

  catTitle: "Videos",
  catLead:
    "Choose what is collected and analysed. The count is what YouTube reports, not a promise of what can be fetched.",
  catRefresh: "Refresh the list",
  catRefreshed: (when: string) => `The list as of ${when}`,
  catNeverRefreshed: "The list has not been built yet.",
  catRequested:
    "A list build was requested; the result appears once it completes.",
  catRequestFailed: "Could not request a list build.",
  catSearch: "Search titles",
  catKindAll: "All",
  catKindVideo: "Video",
  catKindShort: "Short",
  catKindStream: "Stream",
  catSortLabel: "Sort",
  catSortNewest: "Newest",
  catSortOldest: "Oldest",
  catSortMost: "Most commented",
  catSelectPage: "Select this page",
  catPage: (n: number, of: number) => `Page ${n} of ${of}`,
  catPrev: "Previous",
  catNext: "Next",
  catJump: "Go to page",
  catOpenYouTube: "Open on YouTube",
  catPreview: (title: string) => `Preview: ${title}`,
  catPreviewHint:
    "Watched here through YouTube's player; it sets no cookies until you press play.",
  catClose: "Close",
  catClear: "Clear selection",
  catFit: "Select the newest that fits the quota",
  catSelected: (videos: number, upTo: number) =>
    `Selected: ${videos} ${pl(videos, "video", "videos")} · up to ${upTo} ${pl(upTo, "comment", "comments")}`,
  catUnknownCount: (n: number) => `and ${n} with an unknown count`,
  catRemainingAfter: (n: number) => `${n} would remain`,
  catExceeds:
    "The selection exceeds what is left of the quota; clear some of it first.",
  catNoPlan: "No plan is active, so there is no quota to measure against.",
  catSave: "Save the selection",
  catSaving: "Saving…",
  catSaved: "The selection was saved and collection was requested.",
  catSavedDeferred:
    "The selection was saved; collection runs on the next cycle.",
  catSavedRunning:
    "The selection was saved; the collection under way does not include it, the next cycle does.",
  catSavedRemoved: "The selection was saved.",
  catSaveFailed: "Could not save the selection.",
  catSaveQuota:
    "The selection was refused: it exceeds what is left of the quota.",
  catCountUnknown: "—",
  catLiveNote:
    "A selected video stays live: its new comments are collected periodically and draw from the quota as they arrive.",
  catStateUnselected: "Not selected",
  catStateWaiting: "Waiting to be collected",
  catStateCollecting: "Collecting now",
  catStateCollected: (n: number, when: string) => `Collected ${n} on ${when}`,
  catStateDisabled: "Comments disabled",
  catStatePartial: "Partial",
  catStateUnchanged: "Unchanged since the last read",
  catEmpty: "No videos in the list yet.",
  catNoMatch: "No results for that search.",
  catReadFailed: "The list could not be read.",
  chooseVideos: "Choose the videos",

  figuresShow: "Show the figures",
  figuresComments: "Comments",
  secSummary: "Summary",
  secVideos: "Videos",
  secVoice: "Audience voice",
  secTiming: "Timing",
  secPeople: "Commenters",
  secCompare: "Comparison",
  secEngaged: "Most engaged",
  secComments: "Comments",
  dateOrderError: "The start date must come before the end date",
  chipSearch: (q: string) => `search: “${q}”`,
  chipVideo: "one video",
  chipSentiment: (label: string) => `sentiment: ${label}`,
  chipVideoKind: "video kind",
  chipCommentType: "comment type",
  chipRepliesOnly: "replies only",
  chipCommentsOnly: "comments only",
  chipReviewedOnly: "reviewed only",
  chipUnreviewedOnly: "unreviewed only",
  chipDatedOnly: "with a known date",
  chipUndatedOnly: "without a known date",
  chipPeriod: "a set period",
  noKnownDates: "No known dates",
  dashEyebrow: "Overview",
  dashDemoTag: "demo preview",
  dashTitle: "What does your audience say — and where?",
  dashRead: (comments: string, videos: number) =>
    `${comments} ${pl(comments, "comment", "comments")} read across ${videos} ${pl(videos, "video", "videos")}, with who said them and when.`,
  pillComments: (n: string) => `${n} ${pl(n, "comment", "comments")}`,
  pillAuthors: (n: string) => `${n} known ${pl(n, "commenter", "commenters")}`,
  splitOf: (n: string) => `Of ${n} classified ${pl(n, "comment", "comments")}:`,
  readingStored: "Reading the stored comments…",
  reportSectionsLabel: "Report sections",
  filteredLabel: "Filtered:",
  showAll: "Show all",
  hideFilters: "Hide filters",
  showFilters: "Show filters",
  filtersLabel: "Report filters",
  searchLabel: "Search comments and authors",
  videoLabelText: "Video",
  allVideos: "All videos",
  sentimentLabel: "Sentiment",
  allSentiments: "All sentiments",
  videoKindLabel: "Video kind",
  allKinds: "All kinds",
  kindVideo: "Video",
  kindShort: "Short",
  kindStream: "Stream",
  participationLabel: "Participation",
  commentsAndReplies: "Comments and replies",
  originalOnly: "Original comments only",
  repliesOnly: "Replies only",
  commentTypeLabel: "Comment type",
  reviewStatusLabel: "Review status",
  all: "All",
  reviewedByHuman: "Reviewed by a person",
  unreviewed: "Not reviewed",
  dateLabel: "Date",
  allDates: "All dates",
  knownDates: "Known dates",
  unknownDates: "No known date",
  fromDate: "From date",
  toDate: "To date (exclusive)",
  perPageLabel: "Comments per page",
  applyFilters: "Apply filters",
  resetFilters: "Reset filters",
  periodNote:
    "The period follows the comment's publication date, Istanbul time. Comments with no known date appear when all periods are shown.",
  loadingComments: "Loading comments…",
  updatingResults: "Updating results…",
  filtersFailed:
    "Your data arrived, but the filters could not be applied to it.",
  loadFailed: "The data could not be loaded. Try again.",
  failureCode: "Failure code:",
  summaryLead: "The figures below follow the filters applied above.",
  ownerExcluded: (n: string) =>
    `They exclude ${n} ${pl(n, "reply", "replies")} from the channel itself: the channel replying to its followers is not its audience's opinion, and enters no denominator here. The total is therefore lower than YouTube shows by that number.`,
  metricsLabel: "Indicators",
  metricComments: "Comments and replies",
  metricCommentsNote: "Everything that matched the filters.",
  metricAnalysed: "Analysed",
  metricAnalysedNote: "Carry a label valid for the current analysis.",
  metricUnanalysed: "Unanalysed or outdated",
  metricUnanalysedNote: "Stored, and not part of the sentiment shares.",
  metricReplies: "Replies",
  metricRepliesNote: "Replies to comments, not original comments.",
  metricAuthors: "Known commenters",
  metricAuthorsNote: "Counted by channel id, not by display name.",
  insightAnalysis: "Analysis",
  insightAnalysed: (pct: number) =>
    `${pct}% of the matching comments were analysed. The rest are stored without a label and enter no sentiment share.`,
  insightNoMatches:
    "No comments match, so there is no analysis share to report.",
  insightReplies: "Replies",
  insightRepliesShare: (pct: number) =>
    `${pct}% of them are replies — conversation among viewers, not speech aimed at the channel.`,
  insightRepliesNone: "Not enough data to measure the share of replies.",
  insightConcentration: "Concentration",
  insightTopVideo: (top: string, total: string, pct: number) =>
    `The busiest video gathered ${top} of ${total} comments — ${pct}% of all the talk.`,
  insightNoVideo: "No video within the current filters.",
  insightDates: "Dates",
  insightUndated: (n: string) =>
    `${n} ${pl(n, "comment has", "comments have")} no known date. They do not appear in the timing charts and were not put in a default slot.`,
  insightAllDated: "Every matching comment has a known date.",

  emptyNoCommentsTitle: "No comments have arrived yet",
  emptyNoCommentsLead:
    "There are no stored comments for this workspace. The filters have nothing to do with it — no collection has completed yet.",
  emptyFollowCollection: "Choose the videos and follow the collection status",
  emptyConnectOrSync: "Connect a channel",
  emptyNoMatchTitle: "No comments match these filters",
  emptyNoMatchLead: (total: string) =>
    `${total} ${pl(total, "comment is", "comments are")} stored in the workspace, and none matches what you chose. Widen the filters or reset them.`,
  showAllComments: "Show all comments",
  videosLead:
    "Click any video to filter the whole dashboard to it. The figures come from the stored comments, not from YouTube's video metrics.",
  countComments: (n: string) => `${n} ${pl(n, "comment", "comments")}`,
  countReplies: (n: string) => `${n} ${pl(n, "reply", "replies")}`,
  countAnalysed: (n: string) => `${n} analysed`,
  unitComments: "comments",
  voiceLead: (analysed: string) =>
    `Denominator: ${analysed} comments with a valid label — not the total. Mixed sentiment is its own class, not a midpoint between two.`,
  sentimentsTitle: "Sentiment",
  legendMeasured: (label: string, count: string, pct: number) =>
    `${label}: ${count} (${pct}%)`,
  legendUnmeasured: (label: string) =>
    `${label}: not measured by the current model`,
  noLabelsStrong: "No labels yet",
  noLabelsLead:
    "The comments are stored and no classifier has run on them, so there is no sentiment share to show. This is an absence of analysis, not a neutral audience.",
  topicsTitle: "Topics",
  topicsNotRunStrong: "Topic classification has not run yet",
  topicsNotRunLead:
    "Sorting comments into topics needs a language-model layer run by the worker. Once it runs, the topics and their counts appear here.",
  topicsUnclassified: (n: string) => `${n} not yet classified`,
  topicsCaption: "Comments by topic",
  topicsUnit: "Topic",
  topicFilterLabel: "Topic",
  topicAll: "All topics",
  topicUnclassifiedOption: "Not yet classified",
  topicNone: "no topic",
  chipTopic: (name: string) => `Topic: ${name}`,
  topicReviewed: "human correction",
  correctTopic: "Change topic",
  correctTopicFor: (author: string) =>
    `Change the topic of the comment by ${author}`,
  correctTopicLabel: "Correct topic",
  reviewTopicTitle: "Correct the topic",
  reviewTopicCurrent: (topic: string) => `Current topic: ${topic}`,
  reviewKindSentiment: "sentiment",
  reviewKindTopic: "topic",
  figureNegative:
    "negative comments — the ones worth reading in full, not as a share.",
  figurePositive: "positive comments among those analysed.",
  figureUnanalysed: "not labelled yet, and part of no share above.",
  timingTitle: "Engagement timing",
  timingLead:
    "When comments arrive. A comment with an approximate time (“3 months ago”) cannot be placed in an hour, so it is left out and counted rather than assigned to midnight.",
  weeklyTitle: "Comments by week",
  weeklyTooFewStrong: "Too few to draw a trend",
  weeklyTooFewLead:
    "The matching comments fall within fewer than three weeks. A line across them would look like a measured trend, and there is no trend yet.",
  weeklyCaption: "Matching comments, by week",
  weeklyUnit: "Week",
  weeklyUnplaceable: (n: string) =>
    `${n} ${pl(n, "comment", "comments")} with no valid date ${pl(n, "is", "are")} not in this chart.`,
  weeklyAllPlaced: "Every matching comment is in this chart.",
  hourlyTitle: "By hour of day",
  distributionTooFewStrong: "Too few to draw a distribution",
  hourlyTooFewLead:
    "One hour or fewer carries a comment. Empty columns across the day would have said we measured and found silence.",
  hourlyCaption: "Matching comments, by hour of day",
  hourlyUnit: "Hour",
  hourlyUnplaceable: (n: string) =>
    `${n} ${pl(n, "comment", "comments")} with a time coarser than an hour ${pl(n, "is", "are")} left out of this chart.`,
  hourlyAllPlaced: "Every matching comment can be placed in an hour.",
  weekdayTitle: "By day of week",
  weekdayTooFewLead:
    "One day or fewer carries a comment within the current filters.",
  weekdayCaption: "Matching comments, by day of week",
  weekdayUnit: "Day",
  weekdayNote: "Day in your browser's time zone.",
  undatedLabel: "Comments without a date:",
  peopleLead:
    "Who speaks, and who is heard. Identity is by channel id, not display name: two people may share a name, and merging them invents a commenter who does not exist.",
  mostActive: "Most active",
  mostInfluential: "Most influential",
  noCommenterStrong: "No commenter can be counted",
  noCommenterLead:
    "The matching rows carry no author name — either there are no comments, or the names were removed under the retention rule.",
  likesUnknown: "likes unknown",
  countLikes: (n: string) => `${n} ${pl(n, "like", "likes")}`,
  anonymousNote: (n: string) =>
    `${n} ${pl(n, "comment has", "comments have")} an author removed under the retention rule. They were not merged into one commenter and do not appear in the ranking.`,
  compareTitle: "Video comparison",
  compareScope:
    "Figures derived from the comments within the current filters only. Not the video's overall metrics: those have their own scope and observation date.",
  compareTruncated:
    "Only the most-commented videos are compared; the other videos within the filters are not shown here.",
  compareCaption: "Video comparison within the filters",
  colVideo: "Video",
  colComments: "Comments",
  colReplies: "Replies",
  colAnalysed: "Analysed",
  colDistribution: "Distribution",
  noAnalysedInFilters: "No analysed comments within the filters",
  shareItem: (label: string, count: number, pct: number) =>
    `${label} ${count} (${pct}%)`,

  engagedTitle: "Most engaged negative comments",
  engagedLead:
    "Ranked by likes within the current filters. Likes do not weight the label, and a heart from the channel owner is not positive sentiment.",
  engagedEmpty:
    "No negative comments with a known like count within the filters.",
  unitLikes: "likes",
  humanReview: "human review",
  engagedTruncated: (shown: number, ranked: number) =>
    `Showing ${shown} of ${ranked} negative ${pl(ranked, "comment", "comments")} with a known like count.`,
  engagedUnranked: (n: number) =>
    `${n} negative ${pl(n, "comment has", "comments have")} no known like count and ${pl(n, "was", "were")} not ranked. Unknown is not zero.`,
  commentsLead:
    "Click any card to read the comment in full; the table below it is where corrections, export and paging live.",
  tabMostLiked: "Most liked",
  tabNewest: "Newest",
  tabCritical: "Critical",
  noLabel: "no label",
  cursorReset:
    "The results changed, so the view restarted from the first page.",
  exportCsv: "Export CSV",
  exportNote: (total: number) =>
    `Exports every comment matching the current filters (${total}), not only the page shown. Spreadsheet formulas are neutralised in the file without changing the stored text.`,
  exportFailed: "The export file could not be created. Try again.",
  commentsCaption: "Comments within the filters",
  colAuthor: "Author",
  colComment: "Comment",
  colSentiment: "Sentiment",
  colDate: "Date",
  colCorrection: "Correction",
  replyTag: "reply",
  unanalysedOrOld: "unanalysed / outdated",
  correctLabelFor: (author: string) =>
    `Correct the label of the comment by ${author}`,
  correct: "Correct",
  reviewFormLabel: "Correct the label",
  reviewTitle: "Correct a comment's label",
  reviewCurrent: (label: string) =>
    `Current label: ${label}. A human correction overrides the model's prediction for this text, and lapses automatically if the comment's text changes later.`,
  unanalysed: "unanalysed",
  reviewHistoryTitle: "Review history",
  reviewHistoryEmpty: "No previous reviews for this comment.",
  reviewerUnknown: "unknown reviewer",
  correctLabel: "Correct label",
  correctionReason: "Reason for the correction",
  reviewStale:
    "The comment's text changed after this screen was opened. Read it again, then correct the label.",
  reviewSaveFailed: "The correction could not be saved. Try again.",
  saveCorrection: "Save correction",
  cancel: "Cancel",
  reviewFixtureScope:
    "Synthetic data mode: the correction is kept in this session only and is not sent to any server.",
  pagerLabel: "Browse comments",
  previousPage: "Previous page",
  nextPage: "Next page",
  pageState: (page: number, shown: number, total: number) =>
    `Page ${page} — showing ${shown} of ${total} ${pl(total, "comment", "comments")} within the filters`,
  videosPagerLabel: "Browse videos",
  videosPageState: (
    page: number,
    pages: number,
    from: number,
    to: number,
    total: number,
  ) =>
    `Page ${page} of ${pages} — showing ${from}–${to} of ${total} ${pl(total, "video", "videos")}`,

  lpTitle: "Audience Sentiment — understand what lies behind YouTube comments",
  lpMenuLabel: "Main menu",
  lpNavLabel: "Landing page navigation",
  lpNavWhy: "Why Audience Sentiment?",
  lpNavExperience: "See the demo",
  lpNavFaq: "FAQ",
  lpOpenAccount: "Open the account",
  lpHeroEyebrow: "YouTube comments. A clearer view.",
  lpHeroLine1: "Behind every comment,",
  lpHeroLine2: "a voice worth",
  lpHeroLine3: "understanding.",
  lpHeroLead:
    "Do more than count comments. Understand your audience's feelings, compare your videos, and get back to the words that make the difference.",
  lpExploreDashboard: "Explore the dashboard",
  lpSeeHow: "See how it works",
  lpHeroCaption:
    "The example shown here is illustrative; your channel's data requires signing in and connecting.",
  lpHeroArtLabel: "A visual of comments turning into a clear picture",
  lpFloatTopStrong: "Beyond the likes",
  lpFloatTop: "Understand what your audience is actually saying",
  lpFloatBottomStrong: "“Nice, but…”",
  lpFloatBottom: "Mixed sentiment, not neutral",
  lpHeroWord: "Your audience's voice",
  lpValue1: "Built to understand Arabic comments",
  lpValue2: "4 sentiment classes",
  lpValue3: "From the overview to the comment",
  lpValue4: "The last word is yours",
  lpWhyEyebrow: "From the noise of comments to a clear picture",
  lpWhyLine1: "Views say how many people your content reached.",
  lpWhyLine2: "Comments bring you closer to what they felt.",
  lpWhyLead:
    "Bring your reading of sentiment, comparisons and comments into one place, and keep the context behind every number.",
  lpZoomIn: "Look closer",
  lpExperienceEyebrow: "Try the idea",
  lpExperienceLine1: "The whole picture.",
  lpExperienceLine2: "And details worth pausing on.",
  lpExperienceLead:
    "Pick a sentiment to read an example. This is how you move from the audience summary to the comment itself.",
  lpDemoBrand: "Audience overview",
  lpDemoLabel: "Illustrative example · 4 written comments",
  lpDemoChartLabel: "Sentiment within the selection",
  lpDemoInSelection: "comments in the selection",
  lpDemoFilterLabel: "Filter the example by sentiment",
  lpDemoLink: "Discover filters, corrections and export on the dashboard",
  lpBenefit1Tag: "01 / Understand",
  lpBenefit1Title: "Sentiment is not two colours.",
  lpBenefit1:
    "Positive, negative, neutral and mixed. An unanalysed comment stays visible, outside the sentiment shares.",
  lpBenefit2Tag: "02 / Compare",
  lpBenefit2Title: "Put every video in context.",
  lpBenefit2:
    "Change the video or the period to see results under the same filters, then examine the comments behind them.",
  lpBenefit3Tag: "03 / Review",
  lpBenefit3Title: "Your judgement is part of the picture.",
  lpBenefit3:
    "Review a label and correct it, with a reason. The machine's reading is a start; a human review gives it context.",
  lpAudienceEyebrow: "Room for your work, whatever your role",
  lpAudienceLine1: "Close to your audience.",
  lpAudienceLine2: "Suited to how you work.",
  lpAudienceTabsLabel: "Choose the kind of work you do",
  lpCreators: "Creators",
  lpAgencies: "Agencies and teams",
  lpForYou: "For you and your audience",
  lpForTeam: "For your team and your clients",
  lpCreatorTitle: "Your next video starts with listening.",
  lpCreatorText:
    "Get back to the comments that deserve your attention. Compare how your videos were received, and see where your audience agrees and where it differs.",
  lpCreatorTags: ["Compare videos", "Review reactions", "Plan content"],
  lpAgencyTitle: "Every client has an audience. Every audience has a voice.",
  lpAgencyText:
    "A clear reading of each audience, and reports that keep the filters your results were built on. Try review and export now; moving between clients is part of the early build.",
  lpAgencyTags: ["Separate workspaces", "Exportable reports", "Human review"],
  lpExploreWork: "Explore the working demo",
  lpYourChannelSpace: "Your channel's workspace",
  lpClientSpace: "Client workspace",
  lpVideoRow: "A deeper understanding of the content",
  lpWindowNote: "One filter, one consistent picture",
  lpArtCaption: "Interface mock-up · illustrative data",
  lpTrustEyebrow: "Clarity you can build on",
  lpTrustLine1: "Trust starts",
  lpTrustLine2: "with knowing the",
  lpTrustLine3: "limits of the data.",
  lpTrustLead:
    "Not every comment is available, and not every label is certain. So we show what was analysed and what needs review.",
  lpTrust1Title: "Context behind every share",
  lpTrust1:
    "Know the analysed comments, the unknown dates and the scope of the filters before interpreting results.",
  lpTrust2Title: "Collection status in view",
  lpTrust2:
    "Partial coverage or a failed collection does not mean your audience did not comment.",
  lpTrust3Title: "A report that reflects what you see",
  lpTrust3:
    "Export comments under the same filters, keeping the label's source and the available review log.",
  lpFaqEyebrow: "Before you start",
  lpFaqTitle: "Fair questions.",
  lpFaqLead: "This is a beta. Here is what you can try now.",
  lpFaq: [
    "Is the demo data from a real channel?",
    "The interactive example on this page uses clearly labelled synthetic comments. Comments from a real test channel are stored in the service and are being connected to the live dashboard for the workspace owner.",
    "Can I connect my channel now?",
    "YouTube connection is available in the private preview for authorised accounts, and real comments have been collected for a test channel. Syncing requires the collector to be running, and live-model sentiment analysis and live-dashboard verification are still being completed.",
    "Is sentiment analysis always accurate?",
    "No. Sarcasm, dialects and context can make a label ambiguous. That is why the demo includes a mixed class and human correction; no accuracy figure for a live model has been adopted yet.",
    "Are my corrections saved in the demo?",
    "Corrections on synthetic data stay in the browser session only and are not sent to a server. The data-source strip inside the dashboard says when reviews are saved.",
  ],
  lpFinalLine1: "Your audience is talking.",
  lpFinalLine2: "Start listening.",
  lpFinalLead:
    "Take a tour of an Arabic-first experience that brings comments closer to understanding.",
  lpFinalCaption:
    "The example here is illustrative · channel connection for authorised accounts",
  lpFooterTagline: "A clearer view of what lies behind YouTube comments.",
  lpFooterNavLabel: "Footer links",
  lpFooterDashboard: "Dashboard",
  lpFooterAccount: "Account",
  lpFooterVersion: "Audience Sentiment · early version",
  lpFooterPreview: "Private preview — not a public launch",
  legalNavLabel: "Legal pages",
  legalPrivacy: "Privacy Policy",
  legalTerms: "Terms of Service",
  legalUpdated: "Last updated",
  legalContents: "On this page",
  arrowForward: "→",
  arrowUpForward: "↗",
  arrowDownForward: "↘",
  listSeparator: ", ",
};
