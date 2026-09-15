/**
 * The three steps from an account to a dashboard, and where a workspace is on
 * them.
 *
 * The signed-out account page has always listed the steps — as marketing copy,
 * a static `<ol>` shown to a visitor. The moment the reader signed in, the list
 * vanished, and the page that should have said "you are here" showed a card
 * with a button on it and left the reader to infer the order. The audit's
 * finding was that there is no guided setup; the fact is that there was one,
 * shown only to the people who could not act on it.
 *
 * So the steps are written once, here, and read by both screens: the visitor
 * sees them as a promise, the owner sees them with a state on each. Same
 * three sentences — if they ever differ, the product has described itself two
 * ways.
 *
 * The state is a pure function of what the account page already loads, plus
 * the latest job. It does not read the queue, the worker or the run history:
 * "requested" is as far as this page can honestly see. Whether the job then
 * ran is the operations page's question, and this page says so rather than
 * guessing.
 */

export type StepKey = "workspace" | "channel" | "collect";

export type StepStatus =
  /** Behind the reader. */
  | "done"
  /** The one thing to do now. */
  | "next"
  /** Cannot be started until an earlier step is done. */
  | "later"
  /** Started, and something went wrong that the reader must act on. */
  | "attention"
  /** Started and not finished — a queued or running job. */
  | "pending";

export type SetupStep = {
  key: StepKey;
  /** The imperative sentence, the same one the visitor reads. */
  title: string;
  status: StepStatus;
  /** What the state means for this workspace, when the title alone does not say. */
  detail: string | null;
};

/** The promise, in order. */
export const setupSteps: { key: StepKey; title: string }[] = [
  { key: "workspace", title: "أنشئ حسابك ومساحة العمل الخاصة بك." },
  { key: "channel", title: "اربط قناة يوتيوب بعد موافقتك على الإذن." },
  { key: "collect", title: "اطلب الجمع، ثم تابع حالته ونتائجه في اللوحة." },
];

export type ChannelStatus =
  | "public_unverified"
  | "connected"
  | "reconnect_required"
  | "disconnected";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "partial"
  | "failed"
  | "blocked"
  | "cancelled";

export function setupProgress(input: {
  /** The workspace's channel row, or null when none has been attached. */
  channel: { status: ChannelStatus | string } | null;
  /** The most recent job for the workspace, or null when none was ever asked for. */
  latestJob: { status: JobStatus | string } | null;
}): SetupStep[] {
  const { channel, latestJob } = input;
  const [workspace, link, collect] = setupSteps;

  // Being on this list at all means the first step happened.
  const first: SetupStep = { ...workspace, status: "done", detail: null };

  let second: SetupStep;
  if (!channel) second = { ...link, status: "next", detail: null };
  else if (channel.status === "connected")
    second = { ...link, status: "done", detail: null };
  else if (channel.status === "public_unverified")
    // The operator seeded a public channel into this workspace and nobody has
    // proved they own it yet. That is step two not yet taken, not step two
    // gone wrong: the instruction is still "connect", with the reason said.
    second = {
      ...link,
      status: "next",
      detail: "القناة مسجَّلة بلا إذن بعد؛ اربطها لتأكيد ملكيتها.",
    };
  else
    // A grant that existed and no longer works: revoked, expired, or cut. The
    // reader has to go through consent again, and that is a different
    // instruction from "connect" — it is why the step is not "next".
    second = {
      ...link,
      status: "attention",
      detail: "القناة تحتاج إعادة ربط؛ الإذن السابق لم يعد صالحًا.",
    };

  let third: SetupStep;
  if (second.status !== "done")
    third = { ...collect, status: "later", detail: null };
  else if (!latestJob) third = { ...collect, status: "next", detail: null };
  else
    switch (latestJob.status) {
      case "succeeded":
      case "partial":
        // Partial is still a collection that happened; what it missed is the
        // operations page's story, not a reason to send the reader back a step.
        third = { ...collect, status: "done", detail: null };
        break;
      case "queued":
      case "running":
        third = {
          ...collect,
          status: "pending",
          detail: "الطلب قائم؛ تفاصيل التقدّم في صفحة التشغيل.",
        };
        break;
      default:
        // failed, blocked, cancelled — and anything this page does not know,
        // which it should not read as fine.
        third = {
          ...collect,
          status: "attention",
          detail: "آخر محاولة لم تكتمل؛ السبب في صفحة التشغيل.",
        };
    }

  return [first, second, third];
}
