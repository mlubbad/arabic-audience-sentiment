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
  railWorkspaceCaption: "Workspace",
  railWorkspaceNone: "No workspace chosen yet",
  railCollectionCaption: "Collection",
  railCollectionReading: "Reading collection state…",
  railCollectionUnavailable: "Collection state could not be read",
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
    "Your sync request is in. Each channel has one request at a time, and it starts when collection is running — its state right now is on the “Sync status” page.",
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
    `${comments} comments from ${videos} videos`,
  dsCoverageComplete: (counted: string) =>
    `${counted}. The source was read to its end in the last collection.`,
  dsCoveragePartial: (counted: string) =>
    `${counted}. The source was not read to its end, so coverage is partial.`,
  dsNoPreviousRun: "There is no previous collection.",
  dsHealthUnknown: "The collection status is unknown.",
  dsUpdatedUnderHour: "Last updated less than an hour ago.",
  dsUpdatedHours: (hours: string) => `Last updated ${hours} hours ago.`,
  dsFixtureBadge: "Synthetic data",
  dsFixtureScope: "A demo workspace, not connected to any channel",
  dsFixtureReading: "Reading the test data.",
  dsFixtureCoverage: (total: string) =>
    `${total} comments written for testing. They represent no real audience.`,
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
  opsQueued: (n: number) => `Jobs waiting: ${n}`,
  opsWorkerLabel: "Collection:",
  opsWorkerConnected: (heartbeat: string) =>
    `running, last sign of life ${heartbeat}`,
  opsWorkerDisconnected:
    "stopped right now — nothing is running. Data will not refresh until it resumes.",
  opsRequesting: "Requesting…",
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
  opsNoAttemptsLead: "Request a sync from the account page.",
  opsAttemptN: (n: number) => ` · attempt ${n}`,
  opsCancel: "Withdraw from the queue",
  refresh: "Refresh",
  opsCancelFailed:
    "The job could not be withdrawn — a worker may have started it already.",
  opsRetryFailed: "The retry could not be registered.",
  opsCancelled: "The job was withdrawn from the queue.",
  opsRetried:
    "A new attempt was added; it resumes where the previous one stopped.",
  opsSyncRequestFailed: "The sync request could not be registered.",
  opsSyncRequestStanding:
    "Your sync request is in. Each channel has one request at a time, and it starts when collection is running.",
};
