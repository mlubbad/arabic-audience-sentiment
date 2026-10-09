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
  brandOwnerName: "Sky Develop",
  brandHomeLabel: "Audience Sentiment — home",
  skipToContent: "Skip to content",
  announcementLead: "Your audience's voice, more clearly",
  announcementLabel: "Language bar",
  railLabel: "Sidebar",
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
    "Some pages show illustrative, authored data, and say so plainly.",
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
  stepChannelWithPublic:
    "Select a channel by connecting as owner or choosing a public one.",
  stepCollect:
    "Choose the videos to collect, then follow their status on the operations page.",
  stepChannelSeeded:
    "Public channel chosen for monitoring; next step is choosing videos.",
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
  channelSeeded: "Public channel (monitored): ",
  channelNeedsRelink: (status: string) =>
    `The channel needs reconnecting (${status}): `,
  channelIdLabel: "ID",
  channelNone: "No channel connected yet",
  channelSetupHeading: "Workspace channel setup",
  channelSetupSubheading:
    "Choose one path based on channel ownership (mutually exclusive):",
  channelOptionOwnerBadge: "Official owner",
  channelOptionOwnerTitle: "I own the channel",
  channelOptionOwnerDesc:
    "Connect via official Google account to verify ownership and grant full read & analysis access.",
  channelOptionOwnerAction: "Connect YouTube via Google",
  channelOptionPublicBadge: "Public monitoring",
  channelOptionPublicTitle: "I don't own the channel",
  channelOptionPublicDesc:
    "Search and select any public channel (YouTube, Telegram, X, TikTok) to monitor without owner login.",
  channelOptionPublicAction: "Search & select channel",
  searchPublicChannelHeading:
    "Search for a public channel to monitor (no login or ownership needed)",
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
  shareWorkspace: "Share workspace",
  shareWorkspaceTitle: (name: string) => `Share workspace "${name}"`,
  shareWorkspaceLead:
    "Share this workspace with other accounts by email under a specific role.",
  shareWorkspaceAccountsCount: (count: number, limit: number | null) =>
    limit !== null
      ? `${count} of ${limit} accounts used`
      : `${count} accounts (unlimited)`,
  shareWorkspaceEmailLabel: "Account email address",
  shareWorkspaceEmailPlaceholder: "name@example.com",
  shareWorkspaceRoleLabel: "Role",
  shareWorkspaceRoleAnalyst: "Analyst (analyze, sync, and review)",
  shareWorkspaceRoleViewer: "Viewer (read-only access)",
  shareWorkspaceSubmit: "Share workspace",
  shareWorkspaceAccountsList: "Accounts with access",
  shareWorkspaceRoleOwner: "Owner",
  shareWorkspaceRoleAnalystBadge: "Analyst",
  shareWorkspaceRoleViewerBadge: "Viewer",
  shareWorkspaceUnshare: "Remove access",
  shareWorkspaceUnshareConfirm: (email: string) =>
    `Are you sure you want to remove access for ${email}?`,
  shareWorkspaceUserNotFound:
    "This email is not registered on the platform. Please create an account first.",
  shareWorkspaceLimitReached:
    "The maximum number of accounts allowed for your plan has been reached.",
  shareWorkspaceAlreadyMember:
    "This account is already a member of this workspace.",
  shareWorkspaceDone: "Workspace shared successfully.",
  shareWorkspaceUnsharedDone: "Access removed successfully.",
  shareWorkspaceRoleUpdatedDone: "Role updated successfully.",
  shareWorkspaceFailed: (err: string) => `Could not share workspace: ${err}`,
  shareWorkspaceClose: "Close",
  connectChannel: "Connect a YouTube channel",
  relinkForName: "Reconnect to store the channel's name",
  addChannel: "Add a channel by link or search",
  addChannelLead:
    "Paste the channel's link, its handle (@handle), or type a name to search. Public data is collected without linking the channel's account, which can be linked later.",
  addChannelPlaceholder: "youtube.com/@channel, @handle, or a name to search",
  addChannelSearch: "Search",
  addChannelNone: "No matching channels found. Try another id form or name.",
  addChannelAdd: "Add",
  addChannelCancel: "Cancel",
  addChannelDone:
    "The channel was added as public data. The next step is listing its videos.",
  addChannelExists: "This channel is already added to this workspace.",
  addChannelFailed: "The channel search failed. Try again.",
  addChannelFailedCode: (code: string) =>
    `The channel search failed (error code: \u2068${code}\u2069). Try again; if it keeps failing, send this code to support.`,
  addChannelQueryInvalid:
    "Enter a valid channel link, a handle, or a name to search.",
  addChannelNotConfigured:
    "Channel lookup is not configured on the server yet.",
  addChannelQuota:
    "YouTube's daily search quota is spent. Try tomorrow, or enter the channel id directly.",
  selectPlatform: "Select platform",
  addTelegramChannel: "Add a public Telegram channel",
  addTelegramLead:
    "Enter a public Telegram channel handle (@handle) or link (t.me/...). Note: must be a public broadcast channel; personal user accounts and private groups cannot be imported.",
  addTelegramPlaceholder: "@channel_name or t.me/channel_name",
  addTelegramInvalidHandle:
    "Please enter a valid Telegram channel handle or link (e.g. @channel or t.me/channel).",
  addXChannel: "Add a public X (Twitter) account",
  addXLead:
    "Enter the X (Twitter) handle (@username) or profile link. Tweets and replies are collected automatically.",
  addXPlaceholder: "@username or x.com/username",
  addXInvalidHandle:
    "Please enter a valid X handle or profile link (e.g. @username or x.com/username).",
  addTikTokChannel: "Add a public TikTok account",
  addTikTokLead:
    "Enter the TikTok handle (@username) or profile link. Videos and comments are collected automatically.",
  addTikTokPlaceholder: "@username or tiktok.com/@username",
  addTikTokInvalidHandle:
    "Please enter a valid TikTok handle or profile link (e.g. @username or tiktok.com/@username).",
  addDirectAvailable: "Direct add (based on availability)",
  addDirectAvailableAction: "Add channel directly based on availability",
  addDirectAvailableDesc:
    "If the platform does not permit pre-search by name, you can proceed with direct add using the available handle.",
  platformSearchNotPermitted:
    "Pre-search is not permitted or restricted on this platform. The handle was verified and can be added based on availability.",
  channelNotFoundOnPlatform:
    "Channel not found via live preview or is not public. You can add it directly based on availability.",

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
  pricingHeading: "YouTube comment analysis pricing",
  pricingDescription:
    "YouTube comment analysis plans: a free plan, then monthly or yearly plans for creators, agencies and media teams. Each comment counted once; USD, before tax.",
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
  adminPlanPicker: "Choose a plan",
  adminStatus: "Status",
  adminPeriodEnd: "Period end",
  adminProvider: "Provider",
  adminMonths: "Months",
  adminNote: "Note",
  adminKind: "Kind",
  adminUnits: "Units",
  adminSetPlan: "Set plan",
  adminGrantPack: "Grant pack",
  adminDelete: "Delete permanently",
  adminDeleteTitle: (name: string) => `Delete “${name}” permanently`,
  adminDeleteLead:
    "This is a real deletion and cannot be undone: the channel, its comments, labels, reviews and history are all erased. Nothing can be recovered.",
  adminDeleteFootprint: (n: {
    channels: number;
    videos: number;
    comments: number;
    predictions: number;
    reviews: number;
    members: number;
  }) =>
    `${n.channels} channels · ${n.videos} videos · ${n.comments} comments · ${n.predictions} labels · ${n.reviews} reviews · ${n.members} members`,
  adminDeleteFootprintReading: "Counting what will be deleted…",
  adminDeleteTypeName: (name: string) =>
    `Type the workspace name “${name}” to confirm`,
  adminDeleteConfirm: "Delete permanently",
  adminDeleteCancel: "Cancel",
  adminDeleteClose: "Close",
  adminDeleteDone: (name: string) => `“${name}” was permanently deleted.`,
  adminDeleteBillingRoot:
    "Other workspaces bill under this one; it cannot be deleted while it is a billing root.",
  adminDeleteLast:
    "Your last workspace cannot be deleted; create another first.",
  adminOverride: "Override the active Paddle subscription",
  adminPaddleActive:
    "This workspace has an active Paddle subscription; enable override to change it",
  adminDone: "Applied.",
  adminFailed: (code: string) => `Could not apply: ${code}`,
  adminDemoLead:
    "An illustrative copy of the admin page: changes stay in this session.",
  adminInspectWorkspace: "Inspect workspace",
  adminInspectionBadge: "Supervisor Mode",
  adminInspectionBanner: (name: string, owner?: string) =>
    owner
      ? `Supervisor mode: inspecting workspace "${name}" (Owner: ${owner})`
      : `Supervisor mode: inspecting workspace "${name}"`,
  adminInspectionReturn: "Return to Admin",

  // ---- the admin observability pages (phase one of the admin roadmap) ----
  // Five screens, one room: tabs under every admin page head.
  adminTabsLabel: "Admin sections",
  adminTabWorkspaces: "Workspaces",
  adminTabUsers: "Users",
  adminTabChannels: "Channels",
  adminTabPlans: "Account Types",
  adminTabOps: "Operations",
  adminTabServices: "Services & Health",
  adminTabAudit: "Audit trail",
  adminTabImport: "Import channels",
  // bulk channel import (platform owner only)
  adminImportTitle: "Import channels in bulk",
  adminImportLead:
    "Upload a CSV of YouTube channels: each gets a workspace named after it, with the channel attached and its videos catalogued at once. A channel your account already holds is not imported again.",
  adminImportFileLabel: "CSV file",
  adminImportFileHint:
    "One channel per row under a name column, with an optional url column (channel link, @handle or UC id). Ranked lists with a channel column headed in Arabic are read too.",
  adminImportSummary: (n: number, direct: number, search: number) =>
    `${n} channels: ${direct} by link, ${search} by name search.`,
  adminImportUnits: (units: number) =>
    `Looking them up costs about ${units} units of the project's daily YouTube quota (10,000 by default): a name search is 100 units, a link is 1.`,
  adminImportDuplicates: (n: number) => `${n} repeated rows were merged.`,
  adminImportRejected: (n: number) =>
    `${n} links name no YouTube channel and were set aside.`,
  adminImportEmptyFile:
    "The file has no column of channel names (name, or its Arabic header).",
  adminImportReadFailed: "The file could not be read.",
  adminImportFind: "Find the channels",
  adminImportStop: "Stop",
  adminImportContinue: "Continue searching",
  adminImportQuotaHalted:
    "YouTube's daily quota is spent. Searching stopped at this row; press “Continue searching” tomorrow and it picks up from here.",
  adminImportNoHome:
    "Create a workspace of your own first: the channel search runs through it.",
  adminImportColRank: "#",
  adminImportColName: "In the file",
  adminImportColMatch: "Channel on YouTube",
  adminImportColResult: "Result",
  adminImportWaiting: "Not looked up yet",
  adminImportSearching: "Looking up…",
  adminImportNotFound: "No channel found",
  adminImportLookupFailed: (code: string) => `Lookup failed (${code})`,
  adminImportSkip: "Skip this channel",
  adminImportPick: "Choose the right channel",
  adminImportOpen: "Open on YouTube",
  adminImportRun: (n: number) => `Create ${n} workspaces`,
  adminImportRunning: "Creating…",
  adminImportCreated: "Workspace created; cataloguing started",
  adminImportExists: (name: string) => `Already in your account: ${name}`,
  adminImportFailed: (code: string) => `Could not create (${code})`,
  adminImportRetry: "Retry",
  adminImportProgress: (
    lookedUp: number,
    total: number,
    confirmed: number,
    undecided: number,
  ) =>
    `${lookedUp} of ${total} looked up · ${confirmed} ready to create · ${undecided} waiting for your choice`,
  adminImportDone: (created: number, existing: number, failed: number) =>
    `${created} workspaces created · ${existing} already held · ${failed} failed`,
  adminImportCollectionNote:
    "Each new workspace bills to your home workspace's plan. The channel's videos are catalogued at once, its latest 20 are then selected for comment collection, and videos it publishes later are added automatically, at most 5 a day.",
  adminImportClear: "Clear the list",
  adminImportDemo: "The import works on live data only.",
  // plans & account types
  adminPlansTitle: "Account Types & Permissions",
  adminPlansLead:
    "Manage account tiers and control access to public channel tracking (the 'Don't own channel' option) per plan.",
  adminPlansLoading: "Reading account types…",
  adminPlansEmpty: "No plans recorded yet.",
  adminPlansHeading: "Available Account Types",
  adminPlanColName: "Account Type",
  adminPlanColKey: "Key",
  adminPlanColSegment: "Segment",
  adminPlanColPrice: "Monthly Price",
  adminPlanColPublicChannels: "Public Channels Option",
  adminPlanColLimits: "Limits & Quota",
  adminPlanEditLimits: "Edit Limits",
  adminPlanEditLimitsTitle: "Edit Plan Limits",
  adminPlanChannelsLimit: "Max Channels",
  adminPlanAnalysisUnits: "Monthly Analysis Units",
  adminPlanBackfillUnits: "Historical Backfill Units",
  adminPlanHistoricalDays: "Historical Depth Limit (Days)",
  adminPlanRetentionDays: "Data Retention (Days)",
  adminPlanTopicUnits: "Monthly Topic Units",
  adminPlanMembersLimit: "Max Team Members",
  adminPlanWorkspacesLimit: "Max Workspaces",
  adminPlanUnlimitedCheckbox: "Unlimited",
  adminPlanUnlimitedHelp: "Enter -1 or check «Unlimited» for no ceiling",
  adminPlanSaveLimits: "Save Limits",
  adminPlanSavingLimits: "Saving…",
  adminPlanLimitsUpdated: "Plan limits updated successfully.",
  adminPlanLimitsUpdateFailed: "Failed to update plan limits.",
  adminPlanOwnerAlwaysActive: "Always active for owner",
  adminPlanPublicChannelsAllowed: "Allowed",
  adminPlanPublicChannelsBlocked: "Blocked",
  adminPlanToggleSuccess: "Account type permission updated successfully.",
  adminPlanToggleFailed: "Failed to update account type permission.",
  // users
  adminUsersTitle: "Users",
  adminUsersLead:
    "Everyone who signed up, when they were last here, and how they spread across workspaces.",
  adminUsersLoading: "Reading users…",
  adminUsersEmpty: "No users yet.",
  adminUsersHeading: "Users",
  adminUsersEmail: "Email",
  adminUsersJoined: "Joined",
  adminUsersLastSeen: "Last seen",
  adminUsersWorkspaces: "Workspaces",
  adminUsersOwned: "Owned",
  adminUsersNoEmail: "No email",
  adminUsersActions: "Actions",
  adminUserImpersonate: "Log in as",
  adminUserCurrent: "(Your account)",
  adminImpersonationBadge: "User Impersonation Mode",
  adminImpersonationBanner: (email: string) =>
    `You are currently viewing the platform as: ${email}`,
  adminImpersonationReturn: "Return to Admin Account",
  adminImpersonationActive: "Impersonating",
  adminImpersonationExitAction: "Exit Impersonation & Return to Admin",
  adminImpersonateStarting: "Switching to user view…",
  adminImpersonateStopping: "Returning to admin account…",
  adminImpersonateError: "Failed to start impersonation for this account.",
  adminUsersPiiNote:
    "Email is personal data: it shows here because the database checked that you are an operator, and every admin action to come is written to the trail.",
  // channels
  adminChannelsTitle: "Channels",
  adminChannelsLead:
    "Every connected channel, the workspace it feeds, what it has collected, and the state of its last sync.",
  adminChannelsLoading: "Reading channels…",
  adminChannelsEmpty: "No channels yet.",
  adminChannelsHeading: "Channels",
  adminChannelsChannel: "Channel",
  adminChannelsWorkspace: "Workspace",
  adminChannelsStatus: "Status",
  adminChannelsVideos: "Videos",
  adminChannelsComments: "Comments",
  adminChannelsLastSync: "Last sync",
  adminChannelsConnected: "Connected",
  adminChannelsUnverified: "Awaiting verification",
  adminChannelsReconnect: "Reconnect needed",
  adminChannelsDisconnected: "Disconnected",
  adminChannelsNeverSynced: "Never synced",
  // ops
  adminOpsTitle: "Operations",
  adminOpsLead:
    "The platform's numbers today, and the recent failed syncs — what notifications will watch, before the user does.",
  adminOpsLoading: "Reading the operations state…",
  adminOpsHeading: "Platform state",
  adminOpsWorkspaces: "Workspaces",
  adminOpsChannels: "Channels",
  adminOpsComments7d: "Comments this week",
  adminOpsRuns7d: "Syncs this week",
  adminOpsFailed7d: "Failed syncs",
  adminOpsJobsOpen: "Jobs in queue",
  adminOpsWorkerFresh: "Worker active",
  adminOpsWorkerStale: "Worker silent",
  adminOpsWorkerLabel: "Processing worker",
  adminOpsFailedHeading: "Failed or partial syncs",
  adminOpsFailedLead: "The last two weeks, newest first, up to 25 rows.",
  adminOpsFailedEmpty: "No failed syncs in the last two weeks.",
  adminOpsFailedWhen: "When",
  adminOpsFailedWorkspace: "Workspace",
  adminOpsFailedChannel: "Channel",
  adminOpsFailedMode: "Mode",
  adminOpsFailedStatus: "Status",
  adminOpsFailedError: "Error code",
  adminOpsFailedNoChannel: "Deleted channel",
  // audit
  adminAuditTitle: "Audit trail",
  adminAuditLead:
    "What the operator's hand did: to which workspace, from which account, when — and the trail can be neither edited nor erased.",
  adminAuditLoading: "Reading the trail…",
  adminAuditEmpty: "The trail is empty.",
  adminAuditHeading: "Trail",
  adminAuditLimitLabel: "Rows",
  adminAuditWhen: "When",
  adminAuditWorkspace: "Workspace",
  adminAuditActor: "Actor",
  adminAuditAction: "Action",
  adminAuditTarget: "Target",

  // ---- services health & telemetry dashboard ----
  adminServicesTitle: "Services Health & Observability",
  adminServicesLead:
    "Live health status, response latencies, and quota consumption across all third-party and internal services with configurable auto-refresh.",
  adminServicesRefreshLabel: "Auto-refresh",
  adminServicesRefreshPaused: "Paused",
  adminServicesRefresh10s: "10 seconds (intensive)",
  adminServicesRefresh30s: "30 seconds (recommended)",
  adminServicesRefresh1m: "1 minute",
  adminServicesRefresh5m: "5 minutes",
  adminServicesRefreshNow: "Refresh now",
  adminServicesRefreshing: "Refreshing…",
  adminServicesNextRefresh: (seconds: number) => `Next refresh in ${seconds}s`,
  adminServicesLastChecked: (relative: string) => `Last checked: ${relative}`,
  adminServicesJustNow: "just now",
  adminServicesSecondsAgo: (n: number) => `${n}s ago`,
  adminServicesMinutesAgo: (n: number) => `${n}m ago`,
  adminServicesSearchPlaceholder: "Search services or identifiers…",
  adminServicesFilterAll: "All",
  adminServicesFilterHealthy: "Healthy",
  adminServicesFilterDegraded: "Degraded",
  adminServicesFilterDown: "Down",
  adminServicesFilterUnconfigured: "Unconfigured",
  adminServicesKpiOverall: "Platform Health",
  adminServicesKpiServicesCount: "Monitored Services",
  adminServicesKpiAvgLatency: "Average Latency",
  adminServicesKpiQuotaAlerts: "Critical Quotas",
  adminServicesStatusHealthySentence: "All core services operational",
  adminServicesStatusDegradedSentence: "Some services need attention",
  adminServicesStatusDownSentence: "One or more services experiencing outages",
  adminServicesMsUnit: "ms",
  adminServicesServicesUnit: (count: number) => `${count} services`,
  adminServicesCatInfrastructure: "Infrastructure, Hosting & Database",
  adminServicesCatAi: "AI Engines & ML Processing",
  adminServicesCatIngestion: "Data Ingestion & Omnichannel APIs",
  adminServicesCatBilling: "Billing & Supporting Services",
  adminServicesLatency: "Latency",
  adminServicesQuotaUsage: "Usage",
  adminServicesQuotaRemaining: (rem: string, pct: string) =>
    `Remaining: ${rem} (${pct})`,
  adminServicesNoQuota: "No quota limits",
  adminServicesDetailsBtn: "Technical Diagnostics",
  adminServicesDialogTitle: "Technical Diagnostics & Service Details",
  adminServicesDialogClose: "Close",
  adminServicesDialogEndpoint: "Endpoint",
  adminServicesDialogStatus: "Current Status",
  adminServicesDialogLatency: "Response Latency",
  adminServicesDialogQuota: "Quota & Limits",
  adminServicesDialogDetails: "Diagnostics & Indicators",
  adminServicesDialogErrorCode: "Error Code",
  adminServicesDialogRemediation: "Recommended Remediation",
  adminServicesLoading: "Reading services health & indicators…",
  adminServicesEmpty: "No services matching the search criteria.",

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
  accountDemoLead:
    "An illustrative account page: example workspaces and a plan; changes stay in this session.",
  demoExternalNote:
    "This action opens an external service and does not run in the illustrative copy.",
  accountUnavailableTitle: "Sign-in is not available in this preview",
  accountUnavailableLead:
    "A development project URL and a publishable key are needed to enable accounts. Test data is never used as a session.",
  accountTryDashboardTitle: "Start with the dashboard demo",
  accountTryDashboardLead:
    "You can explore the interface with illustrative, authored data.",
  createWorkspaceFailed: "The workspace could not be created",
  createWorkspaceListFailed: "Created, but the list could not be refreshed",
  createWorkspaceDone: "Workspace created",
  authJoinTitle: "Create your account",
  authReturnTitle: "Welcome back",
  authJoinLead: "An account opens one workspace of your own.",
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
    "No customer counts, no logos: there is nothing to count yet, and an invented number at the door undoes what the dashboard says behind it.",
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
    queued: "Work is in the queue; waiting for its turn to process",
    stale: "It has been a long time since the last sync; the data may be old",
    partial:
      "The last sync stopped before its end; coverage is partial, not complete",
    incomplete_coverage:
      "The source ended without proving full coverage; that does not mean every comment was collected",
    failed: "The last sync failed",
    blocked: "The source could not be reached in the last sync",
    quota_paused:
      "YouTube daily API quota reached; sync will resume automatically at 00:00 UTC",
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
  jobTelegramDiscussionRequiresAuth:
    "This channel's discussion group is private or restricted and requires opening the Telegram app; Telegram prevents unauthenticated web access to it.",
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
    "The access token lapsed mid-collection. No need to reconnect the channel — retry, and the permission renews itself.",
  jobQuotaExceeded:
    "The daily YouTube quota is used up. It renews automatically, and the attempt is retried afterwards.",
  jobKindTopics: "Topic classification",
  jobKindCatalogue: "Channel cataloguing",
  jobCatalogueQueuedWithWorker:
    "In the queue, waiting for channel cataloguing to start.",
  jobCatalogueRunningDetail: "Channel cataloguing is running now.",
  jobCatalogueRunningDetailTelegram: "Channel post cataloguing is running now.",
  jobCatalogueRunningDetailX: "Account tweet cataloguing is running now.",
  jobCatalogueRunningDetailTikTok: "Account video cataloguing is running now.",
  jobCatalogueSucceededDetail:
    "Channel videos catalogued and list updated successfully.",
  jobChannelNotPublic:
    "This handle belongs to a personal account, private channel, or another platform without public web preview. Ensure you enter a public Telegram channel handle, or verify that the correct platform was selected (e.g. X or YouTube).",
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
  jobGeminiCreditsDepleted:
    "Gemini prepayment credits are depleted in Google AI Studio. Add credits to enable topic classification (core sentiment analysis remains active).",
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
  dsFixtureBadge: "Illustrative data",
  dsFixtureScope: "An illustrative workspace, not connected to any channel",
  dsFixtureReading: "Reading the illustrative data.",
  dsFixtureCoverage: (total: string) =>
    `${total} ${pl(total, "comment", "comments")} written to illustrate the product; they represent no real audience.`,
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
  opsWorkspaceData: "Operations data for workspace",
  opsDemoNote:
    "Illustrative operations data for the demo, not connected to a real channel.",
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
  opsAttemptsFilterAll: "All",
  opsAttemptsFilterRunning: "Running",
  opsAttemptsFilterSucceeded: "Succeeded",
  opsAttemptsFilterFailed: "Needs Attention",
  opsAttemptsCountTotal: "Total Attempts",
  opsAttemptsCountRunning: "Running",
  opsAttemptsCountSucceeded: "Succeeded",
  opsAttemptsCountAttention: "Needs Attention",
  opsAttemptsPageOf: (page: number, pages: number) =>
    `Page ${page} of ${pages}`,
  opsAttemptsNoMatch: "No attempts match this filter.",
  opsDemoNoLogStrong: "The demo carries no job log",
  opsDemoNoLogLead:
    "Jobs belong to a real account and a connected channel. No invented log is shown here to make the place look full.",
  opsLogFailedStrong: "The job log could not be read",
  opsLogFailedLead: "That does not mean it is empty.",
  opsLogReading: "Reading the attempt log…",
  opsNoAttemptsStrong: "No attempts yet",
  opsNoAttemptsLead: "Choose videos from the catalogue above to start one.",
  opsAttemptN: (n: number) => ` · attempt ${n}`,
  opsRunningDuration: (duration: string) => ` · running for ${duration}`,
  opsCompletedDuration: (duration: string) => ` · completed in ${duration}`,
  opsQueuedDuration: (duration: string) => ` · in queue for ${duration}`,
  opsEstimatedCompletion: (eta: string) => ` · estimated completion: ${eta}`,
  opsDurationTaken: (duration: string) => `time taken: ${duration}`,
  opsQueuedWithEta: (n: number, eta: string) =>
    `queued: ${n} (estimated completion: ${eta})`,
  opsWorkerBusyEta: (eta: string) => `running (estimated completion: ${eta})`,
  opsEstimatedTimeDiscover: "~15–30s",
  opsEstimatedTimeCollect: "~30–60s",
  opsEstimatedTimeAnalyse: "~20–45s",
  opsEstimatedTimeDefault: "within ~1 min",
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
  historicalImportButton: "Historical Backfill & Import",
  historicalImportTitle: "Historical Data Backfill & Import",
  historicalImportLead:
    "Backfill previous posts and comments directly from platforms or import via CSV/JSON files according to your plan quota.",
  historicalTabPlatform: "Platform Backfill",
  historicalTabFile: "External File Upload (CSV / JSON)",
  historicalDaysLimitNotice: (days: number) =>
    `Your current plan allows fetching up to ${days} days back.`,
  historicalBackfillQuotaNotice: (remaining: number) =>
    `Remaining historical backfill quota: ${remaining.toLocaleString()} units.`,
  historicalDaysBack: "Timeframe to fetch (days back)",
  historicalMaxItems: "Maximum items (posts/comments)",
  historicalStartDate: "Start Date (optional)",
  historicalStartSync: "Start Historical Sync",
  historicalStartingSync: "Scheduling sync…",
  historicalSyncQueued: "Historical sync task queued successfully.",
  historicalSyncFailed: "Failed to queue historical sync.",
  historicalSyncPlanNotAllowed:
    "Historical sync is not allowed on your current plan. Please upgrade to access this feature.",
  historicalFileUploadLabel: "Select or drop a CSV or JSON file",
  historicalFileDropzone:
    "Click to select a file or drag & drop here (CSV and JSON supported)",
  historicalDownloadCsvTemplate: "Download Sample CSV Template",
  historicalParsingFile: "Parsing and validating file…",
  historicalFileInvalid: "Invalid file format or missing required columns.",
  historicalPreviewTitle: "Data Preview Before Import",
  historicalPreviewPostsCount: (count: number) => `${count} posts/videos`,
  historicalPreviewCommentsCount: (count: number) => `${count} comments`,
  historicalStartImport: "Confirm & Import Data",
  historicalImporting: "Importing and saving data…",
  historicalImportSuccess: (posts: number, comments: number) =>
    `Successfully imported ${posts} posts and ${comments} comments.`,
  historicalImportFailed: "Failed to import data.",
  historicalImportQuotaExceeded:
    "Number of comments in file exceeds your remaining plan quota.",
  historicalNoChannelSelected: "Please select a channel first.",
  historicalFileCapsHint: (maxMb: number, maxRows: number) =>
    `Maximum file size: ${maxMb} MB and up to ${maxRows.toLocaleString()} comments (1,000).`,
  historicalFileTooLarge: "File size exceeds the 5 MB limit.",
  historicalBatchTooLarge:
    "Batch too large: maximum import size is 1,000 comments per upload.",
  historicalForbidden: "You do not have permission to perform this action.",
  historicalChannelNotFound: "The selected channel was not found.",
  historicalInvalidPayload:
    "Invalid import payload or missing required fields.",
  historicalDateBeyondPlanLimit: (days: number) =>
    `The specified date exceeds your plan's historical limit (${days} days).`,
  historicalCloseModal: "Close dialog",
  catDiscoveringRunning: (elapsed: string, estimated: string) =>
    `running for ${elapsed} · typical estimated time: ${estimated}`,
  catDiscoveringQueued: (elapsed: string, estimated: string) =>
    `in queue for ${elapsed} · typical estimated time: ${estimated}`,
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
  catJump: "Jump to page",
  catOpenYouTube: "Open on YouTube",
  catOpenTelegram: "Open on Telegram",
  catOpenX: "Open on X",
  catOpenTikTok: "Open on TikTok",
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
  catStateCollectedOnly: (n: number) => `Collected ${n}`,
  catStateAnalysedOnly: (n: number) => `Classified ${n}`,
  catStateCollectedAnalysed: (col: number, ana: number) =>
    `Collected ${col} (${ana} classified)`,
  catSummaryTitle: "Saved channel content summary",
  catTotalCollected: (n: number) => `Total stored: ${n} comments`,
  catTotalAnalysed: (n: number) => `Classified: ${n}`,
  catVideosStored: (n: number) => `Stored videos: ${n}`,
  catNextSyncSelected: (n: number) => `Selected for next sync: ${n}`,
  catPreviewCollectedInfo: (col: number, ana: number) =>
    `Stored in database: ${col} comments (${ana} classified)`,
  catStateDisabled: "Comments disabled",
  catStateTelegramAuthRequired: "Requires Telegram app",
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
  secSummaryTitle: "Executive Summary & Audience Pulse",
  secVideosTitle: "Video Performance: Engagement & Sentiment Map",
  secVoiceTitle: "Audience Voice: Sentiment & Discussion Drivers",
  secTimingTitle: "Engagement Timing: When Does Your Audience Speak Up?",
  secPeopleTitle: "Top Commenters: Most Active & Influential Voices",
  secCompareTitle: "Video Comparison: Variance in Audience Sentiment",
  secEngagedTitle: "Critical Feedback: High-Impact Comments Needing Attention",
  secCommentsTitle: "Comments Stream & Human Review Verification",

  // Executive Story Briefing
  storyBriefingEyebrow: "Executive Story & Narrative Briefing",
  storyBriefingTitle: "Audience Pulse & Analytical Takeaway",
  netSentimentScoreLabel: "Net Sentiment Score",
  netSentimentScoreDesc:
    "Relative spread between analysed positive and negative sentiment",
  pulseStrongPositive: "Strong Positive Pulse",
  pulseModeratePositive: "Moderate Positive Pulse",
  pulseBalanced: "Balanced / Neutral Pulse",
  pulseNegativeAttention: "Notable Negative Sentiment",
  pulseCriticalAlert: "Critical Negative Backlash",
  storyAct1Title: "1. Overall Sentiment Pulse",
  storyAct1DominantPos: (posPct: number, negPct: number) =>
    `Positive sentiment represents ${posPct}% of analysed feedback vs ${negPct}% negative, showing strong audience satisfaction.`,
  storyAct1DominantNeg: (negPct: number, posPct: number) =>
    `Negative sentiment represents ${negPct}% outpacing positive (${posPct}%), pointing to widespread critical feedback requiring attention.`,
  storyAct1Balanced: (posPct: number, negPct: number) =>
    `Sentiment is closely divided at ${posPct}% positive and ${negPct}% negative, showing balanced opinions.`,
  storyAct2Title: "2. Topic & Content Focus",
  storyAct2DominantTopic: (name: string, count: string, pct: number) =>
    `Primary discussion driver: “${name}” with ${count} comments (${pct}% of classified talk).`,
  storyAct2TopVideo: (title: string, count: string, pct: number) =>
    `Top video by engagement: “${title}” with ${count} comments (${pct}% of interactions).`,
  storyAct2General:
    "Engagement is distributed across topics without a single dominant theme.",
  storyAct3Title: "3. Actionable Recommendation",
  storyAct3RecCritical:
    "Prioritize responding to top critical comments to clarify misunderstandings and address concerns.",
  storyAct3RecPositive:
    "Audience reception is strongly positive; sustain this momentum with similar content and acknowledge top contributors.",
  storyAct3RecGeneral:
    "Maintain publishing consistency and periodically review sample comments to ensure model accuracy.",

  // Donut & Voice enhancements
  donutCenterNet: "Net Pulse",

  // Timing takeaway & highlighting
  timingPeakHeadline: (day: string, hour: string, count: string) =>
    `Peak engagement window: ${day} at ${hour}:00 (${count} comments).`,
  timingPeakBadge: "Peak Window",
  timingDayPeak: (day: string) => `Busiest day: ${day}`,
  timingHourPeak: (hour: string) => `Busiest hour: ${hour}:00`,

  // Video performance filters & outlier badges
  videoFilterAll: "All videos",
  videoFilterCritical: "Highest criticism",
  videoFilterPositive: "Most positive",
  videoFilterVolume: "Most comments",
  videoTagHighNegative: "High criticism",
  videoTagTopPositive: "Top positive",
  videoTagTopVolume: "Top engagement",

  // Engaged creator tip
  engagedCreatorTip:
    "Actionable tip: These comments received widespread viewer agreement; replying or clarifying officially mitigates controversy and builds trust.",

  // Storytelling with Data KPIs & Actionable Steps
  kpiViews: "Views",
  kpiViewsNote: "Total views across analysed videos",
  kpiLikes: "Likes",
  kpiLikesNote: "Total likes interaction",
  kpiNetSentiment: "Net Sentiment",
  kpiNetSentimentNote:
    "(positive − negative) ÷ (positive + negative); neutral left out",
  kpiEngagement: "Engagement Rate",
  kpiEngagementNote: "(Comments + Likes) / Views",
  actionableStepsTitle: "Actionable Recommendations & Next Steps",
  actionStep1Critical:
    "Proactively address top critical comments to clarify misunderstandings and defuse tension.",
  actionStep2Positive:
    "Amplify high-performing positive themes in upcoming content and engage loyal fans.",
  actionStep3Timing:
    "Leverage peak engagement hours for publishing to maximize reach and response.",
  actionStep4Engagement:
    "Pin clarifying comments or run community polls around trending debate topics.",
  actionStepGeneral:
    "Maintain continuous audience sentiment monitoring with every new release to sustain positive growth.",

  dateOrderError: "The start date must come before the end date",
  chipSearch: (q: string) => `search: “${q}”`,
  chipVideo: "one video",
  chipSentiment: (label: string) => `sentiment: ${label}`,
  chipVideoKind: "video kind",
  chipPlatform: (p: string) => `platform: ${p}`,
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
  dashDemoTag: "illustrative example",
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
  moreFilters: (n: number) => (n > 0 ? `More (${n})` : "More"),
  filtersButton: (n: number) => (n > 0 ? `Filters (${n})` : "Filters"),
  removeFilter: (label: string) => `Remove filter: ${label}`,
  filtersLabel: "Report filters",
  searchLabel: "Search comments and authors",
  videoLabelText: "Video",
  allVideos: "All videos",
  sentimentLabel: "Sentiment",
  allSentiments: "All sentiments",
  videoKindLabel: "Content type",
  allKinds: "All kinds",
  kindVideo: "Video",
  kindShort: "Short",
  kindStream: "Stream",
  kindPost: "Post",
  platformFilterLabel: "Platform",
  allPlatforms: "All platforms",
  platformYouTube: "YouTube",
  platformTelegram: "Telegram",
  platformX: "X (Twitter)",
  platformTikTok: "TikTok",
  platformFacebook: "Facebook",
  platformInstagram: "Instagram",
  platformSoon: "Soon",
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
  exportNote: (total: number, cap = 10000) =>
    total > cap
      ? `Exports the first ${cap.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} comments matching the current filters to protect browser performance. Spreadsheet formulas are neutralised in the file without changing the stored text.`
      : `Exports every comment matching the current filters (${total}), not only the page shown. Spreadsheet formulas are neutralised in the file without changing the stored text.`,
  exportTruncatedNotice: (cap: number, total: number) =>
    `Exported first ${cap.toLocaleString("en-US")} comments only (out of ${total.toLocaleString("en-US")}) for browser stability.`,
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
    "Illustrative data mode: the correction is kept in this session only and is not sent to any server.",
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

  // The landing page. The search phrases here are "YouTube comment analysis",
  // "Arabic sentiment analysis" and "audience sentiment"; see docs/seo.md.
  lpTitle: "Arabic YouTube Comment Analysis — Audience Sentiment",
  lpDescription:
    "Analyse Arabic YouTube comments and see how your audience really feels — positive, negative, neutral or mixed. Compare videos, review labels, export. Free demo.",
  lpMenuLabel: "Main menu",
  lpNavLabel: "Landing page navigation",
  lpNavWhy: "Why analyse comments?",
  lpNavExperience: "See the demo",
  lpNavFaq: "FAQ",
  lpOpenAccount: "Open the account",
  lpHeroEyebrow: "YouTube comment analysis for Arabic audiences",
  lpHeroLine1: "Understand your audience",
  lpHeroLine2: "through YouTube comments,",
  lpHeroLine3: "in Arabic.",
  lpHeroLead:
    "Do more than count likes and views. Sentiment analysis sorts every comment into positive, negative, neutral or mixed, compares how your videos were received, and takes you back to the words that make the difference — built for Arabic comments and their dialects.",
  lpExploreDashboard: "Explore the demo dashboard",
  lpSeeHow: "See how it works",
  lpHeroCaption:
    "The example shown here is illustrative; your channel's data requires signing in and connecting the channel.",
  lpHeroAlt:
    "Illustration: YouTube comments turning into a chart of audience sentiment in Arabic",
  lpFloatTopStrong: "Beyond the likes",
  lpFloatTop: "Understand what your audience is actually saying",
  lpFloatBottomStrong: "“Nice, but…”",
  lpFloatBottom: "Mixed sentiment, not neutral",
  lpHeroWord: "Your audience's voice",
  lpValue1: "Sentiment analysis built for Arabic comments",
  lpValue2: "4 classes: positive, negative, neutral, mixed",
  lpValue3: "From the channel summary to the single comment",
  lpValue4: "Human review; the last word is yours",
  lpWhyEyebrow: "Why analyse YouTube comments?",
  lpWhyLine1: "Views say how many people your content reached.",
  lpWhyLine2: "Comments say how they felt about it.",
  lpWhyLead:
    "Sentiment analysis brings your reading of audience opinion, the comparison between videos and the comments themselves into one place, and keeps the context behind every number — so you know what they liked, what bothered them, and what they are asking for next.",
  lpZoomIn: "Look closer",
  lpExperienceEyebrow: "Try the idea",
  lpExperienceLine1: "The sentiment dashboard:",
  lpExperienceLine2: "from the whole audience to a single comment.",
  lpExperienceLead:
    "Pick a sentiment to read an example. This is how the dashboard moves from the sentiment summary to the comment itself, with the filters the number was built on.",
  lpDemoBrand: "Audience overview",
  lpDemoLabel: "Illustrative example · 4 written comments",
  lpDemoChartLabel: "Sentiment within the selection",
  lpDemoInSelection: "comments in the selection",
  lpDemoFilterLabel: "Filter the example by sentiment",
  lpDemoLink: "Discover filters, corrections and export on the dashboard",
  lpBenefit1Tag: "01 / Understand",
  lpBenefit1Title: "Four sentiment classes, not two colours.",
  lpBenefit1:
    "Positive, negative, neutral and mixed — because “nice, but…” is not a neutral comment. A comment not yet analysed stays visible outside the shares, not hidden inside them.",
  lpBenefit2Tag: "02 / Compare",
  lpBenefit2Title: "Compare your videos under the same filters.",
  lpBenefit2:
    "Change the video or the period to see how the reception changed, then examine the comments behind every share.",
  lpBenefit3Tag: "03 / Review",
  lpBenefit3Title: "Human review corrects the machine's reading.",
  lpBenefit3:
    "Review any label and correct it, with a reason. The model's reading is a start; your knowledge of your audience and its dialect is what gives it context.",
  lpAudienceEyebrow: "Room for your work, whatever your role",
  lpAudienceLine1: "For creators and influencers,",
  lpAudienceLine2: "and for agencies and media teams.",
  lpAudienceTabsLabel: "Choose the kind of work you do",
  lpCreators: "Creators",
  lpAgencies: "Agencies and teams",
  lpForYou: "For you and your audience",
  lpForTeam: "For your team and your clients",
  lpCreatorTitle: "Your next video starts with listening.",
  lpCreatorText:
    "Get back to the comments that deserve your attention. Compare how your videos were received, see where your audience agrees and where it differs, and plan the next video on what they said rather than what you assume.",
  lpCreatorTags: ["Compare videos", "Review reactions", "Plan content"],
  lpAgencyTitle: "Every client has an audience. Every audience has a voice.",
  lpAgencyText:
    "A separate workspace for every client, a clear reading of their audience, and reports that keep the filters your results were built on — instead of reading hundreds of comments by hand before every meeting.",
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
    "Not every comment is available, and not every label is certain. So the dashboard shows what was actually analysed, what was not collected, and what needs review — before you build a decision on a number.",
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
  lpFaqTitle: "Frequently asked questions about YouTube comment analysis",
  lpFaqLead: "Here is what you can do now, and what is still being completed.",
  lpFaq: [
    "What is YouTube comment sentiment analysis?",
    "An automatic reading of every comment that sorts it by the feeling it carries: positive, negative, neutral or mixed. The result is a summary of how your audience felt about a video or a period, with a way back to every comment behind every share.",
    "Does it work with Arabic dialects?",
    "The tool is built for Arabic comments in their different dialects, but sarcasm, dialect and context can make a label ambiguous. That is why the demo includes a mixed class and human correction; no accuracy figure for a live model has been adopted yet.",
    "What is the difference between a mixed and a neutral comment?",
    "A neutral comment carries no clear feeling — a question, a remark, a request. A mixed one carries both at once: “the content is great, but the intro is long”. Merging the two hides the most useful thing in the comments: what your audience liked and what bothered them, in the same sentence.",
    "Is the demo data from a real channel?",
    "The interactive example on this page uses illustrative, authored comments. Comments from a real test channel are stored in the service and are being connected to the live dashboard for the workspace owner.",
    "Can I connect my channel now?",
    "YouTube connection is available for authorised accounts, and real comments have been collected from connected channels. After connecting, syncing runs on the workspace's plan, and every collected comment is analysed automatically.",
    "Does the tool need access to my channel?",
    "Yes. Connecting a channel means signing in with Google and granting two permissions, to read channel data and comments. The service reads and never writes: it does not post, edit or delete anything on your channel. You can revoke the permission from your Google account settings at any time; the details are in the privacy policy.",
    "Are my corrections saved in the demo?",
    "Corrections on illustrative data stay in the browser session only and are not sent to a server. The data-source strip inside the dashboard says when reviews are saved.",
    "How much does YouTube comment analysis cost?",
    "There is a free plan to try it, and monthly or yearly plans for creators, influencers, agencies and media teams. Each analysed comment is counted once however often it is re-collected, and analysis stops at the limit with no surprise bill. All the numbers are on the pricing page.",
  ],
  lpFinalLine1: "Your audience is talking.",
  lpFinalLine2: "Start listening.",
  lpFinalLead:
    "Try the Arabic YouTube comment analysis dashboard — an interactive example now, your channel once you connect it.",
  lpFinalCaption:
    "The example here is illustrative · channel connection for authorised accounts",
  lpFooterTagline: "Audience sentiment from YouTube comments, in Arabic.",
  lpFooterNavLabel: "Footer links",
  lpFooterDashboard: "Dashboard",
  lpFooterAccount: "Account",
  lpFooterVersion: "Audience Sentiment · by Sky Develop",
  legalNavLabel: "Legal pages",
  legalPrivacy: "Privacy Policy",
  legalTerms: "Terms of Service",
  legalUpdated: "Last updated",
  legalContents: "On this page",
  arrowForward: "→",
  arrowUpForward: "↗",
  arrowDownForward: "↘",
  listSeparator: ", ",
  tourWelcomeTitle: "A short tour of audience sentiment",
  tourWelcomeBody:
    "Three pages: Account for workspaces and channels, Operations for what gets collected, and the Dashboard for what your audience said. The tour takes under a minute, and skips at any time.",
  tourStart: "Start the tour",
  tourLater: "Not now",
  tourNext: "Next",
  tourBack: "Back",
  tourFinish: "Finish",
  tourSkip: "Skip the tour",
  tourProgress: (n: number, total: number) => `${n} of ${total}`,
  tourReplay: "Guided tour",
  tourStepRailTitle: "Navigation",
  tourStepRailBody:
    "Three destinations: Overview, Operations, and Sources & account. The workspace switch at the top of the rail decides what each page shows.",
  tourStepWorkspaceTitle: "Workspace",
  tourStepWorkspaceBody:
    "Each channel or client has its own workspace; its data is never read from another. From here you rename it, connect its channel, or retire it.",
  tourStepSetupTitle: "Setup steps",
  tourStepSetupBody:
    "Three steps: the account, then connecting a YouTube channel with your permission, then choosing what gets collected. The next step is always written here.",
  tourStepCatalogueTitle: "The catalogue",
  tourStepCatalogueBody:
    "Every video your channel declares. Choose what gets collected and analysed; the estimate is read before saving, not after.",
  tourStepSelectionTitle: "Saving",
  tourStepSelectionBody:
    "Nothing is collected before saving. The bar states how many comments will be read and how much of the plan's allowance remains after it.",
  tourStepFiltersTitle: "Filters",
  tourStepFiltersBody:
    "Every figure on the dashboard follows what you choose here: the period, the video, the sentiment, and the topic. The bar stays with you while scrolling.",
  tourStepSectionsTitle: "Sections",
  tourStepSectionsBody:
    "Move between the summary, videos, audience voice and comments from here. The tour has ended; find it again any time in the rail.",
  crFinishingHeading: "Finishing the channel connection",
  crFinishingDetail:
    "We are checking that the connection returned to the browser and account that started it.",
  crBindingMismatch:
    "We could not verify the browser or account that started this connection. Start again.",
  crUnauthenticated:
    "Your session ended. Sign in and start the connection again.",
  crUnreachable: "The connection service could not be reached. Try again.",
  adminImpersonateAuditWarning:
    "The impersonation session ended, but its end event was not recorded.",
  adminChannelsLastSuccessfulCollection: "Last successful collection",
  adminChannelsNeverCollected: "Never collected",
  adminChannelsCollectionStale: "Collection stale",
  adminServicesHealthyOfMonitored: (monitored: number, total: number) =>
    `Healthy in ${monitored} of ${total} services that report readings; the rest are not monitored`,
  adminServicesMonitoredOfTotal: (total: number, notMonitored: number) =>
    `of ${total} services; ${notMonitored} not monitored`,
  adminServicesLatencyBasis: (measured: number) =>
    measured === 1
      ? "From the one service that is measured"
      : `From the ${measured} services that are measured`,
  adminServicesQuotaNotMeasured: "Quotas are not measured yet",
  adminServicesQuotaAlertsUnit: "usage alerts",
  adminServicesQuotaSources: "Only services with a known quota",
  adminServicesFilterNotMonitored: "Not monitored",
  adminServicesStatusNotMonitoredSentence:
    "No live telemetry reaches these services yet",
  adminPlanLimitsInvalid:
    "Every field must be a whole number of -1 or more (-1 means unlimited). Nothing was saved.",
};
