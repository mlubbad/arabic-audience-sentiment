/**
 * The platform owner's bulk import: a CSV of YouTube channels in, one
 * workspace per channel out.
 *
 * Three steps, each the owner's to start. Read the file (no network). Look
 * every row up through `channel-lookup` — the same function a person adding
 * one channel uses, run from the owner's own workspace — and confirm the
 * match; a search is proposed only on an exact name match, so a loose result
 * waits for a person. Then create: `admin_import_channel` once per confirmed
 * row, which makes the workspace, files the channel, starts its catalogue,
 * and answers `exists` for a channel the account already holds.
 *
 * The rows live in the browser between visits: a search costs a hundred
 * units of the day's YouTube quota, so a closed tab must not spend them
 * again. The database is the gate (`is_platform_admin()` in the RPC); the
 * page is hidden from everyone else as a courtesy.
 */
import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AdminImportResultSchema,
  ChannelLookupResponseSchema,
  type ChannelCandidate,
} from "@sentiment/contracts";
import { supabase } from "../supabase";
import { useSession } from "../session";
import { useStrings, type Strings } from "../strings";
import { failureCode } from "../failure";
import { lookupCode } from "../account/channelLookupError";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { LoadError, Loading } from "../pageStates/PageStates";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../ui/Table";
import { AdminPageHead, useAdminShell } from "./AdminShell";
import { lookupUnits, parseImportFile } from "./channelImport";
import {
  EMPTY_SESSION,
  chosenCandidate,
  importCounts,
  importReducer,
  loadSaved,
  save,
  type ImportRow,
} from "./channelImportState";

/** The workspace the lookups run through: the first the owner created, in
 *  which they are `workspace_owner` (the role `channel-lookup` requires). */
async function readHomeWorkspace(userId: string): Promise<string | null> {
  const { data, error } = await supabase!.rpc("my_workspaces");
  if (error) throw error;
  const own = ((data ?? []) as { id: string; created_by: string }[]).find(
    (w) => w.created_by === userId,
  );
  return own?.id ?? null;
}

/** A failed RPC's code, never its text: the message can carry the URL. */
function rpcCode(error: { code?: string; message?: string }): string {
  const known = error.message?.match(
    /\b(forbidden|invalid_channel_id|invalid_platform|workspace_limit_reached|public_channels_not_allowed_on_plan|no_active_plan|sync_too_soon|channel_claimed_by_other_client)\b/,
  );
  return known?.[1] ?? error.code ?? "unexpected";
}

export function AdminImportPage() {
  const S = useStrings();
  const { admin, shell } = useAdminShell({ demo: true });
  const { session } = useSession();
  const demo =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("demo");
  const userId = session?.user.id ?? null;
  const home = useQuery({
    queryKey: ["admin", "import-home", userId],
    queryFn: () => readHomeWorkspace(userId!),
    enabled: admin && !demo && !!userId,
  });

  const [state, dispatch] = useReducer(importReducer, EMPTY_SESSION, loadSaved);
  const [running, setRunning] = useState<"lookup" | "import" | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const stop = useRef(false);

  useEffect(() => save(state), [state]);

  // A file of links needs no one to press "search": each link names its
  // channel, so it is verified as soon as the file is read (once per file;
  // a Stop is not undone by the next render).
  const autoVerified = useRef<string | null>(null);
  useEffect(() => {
    if (!home.data || running || state.quotaHalted) return;
    const key = `${state.fileName}:${state.rows.length}:${state.rows[0]?.entry.query ?? ""}`;
    if (autoVerified.current === key) return;
    if (
      !state.rows.some(
        (r) => r.entry.kind === "direct" && r.lookup.state === "idle",
      )
    )
      return;
    autoVerified.current = key;
    void runLookups(home.data, "direct");
  });

  async function readFile(file: File) {
    setFileError(null);
    let text: string;
    try {
      text = await file.text();
    } catch {
      setFileError(S.adminImportReadFailed);
      return;
    }
    const parsed = parseImportFile(text);
    if (!parsed.entries.length) {
      setFileError(S.adminImportEmptyFile);
      return;
    }
    dispatch({ type: "load", fileName: file.name, parsed });
  }

  /** Looks the rows up one by one. `direct` runs only the rows that name
   *  their channel (a link, a handle, an id): one quota unit each and no
   *  choice to make, so they run on their own once the file is read. The
   *  owner's button runs everything still waiting, name searches included. */
  async function runLookups(homeId: string, only?: "direct") {
    stop.current = false;
    setRunning("lookup");
    if (!only) dispatch({ type: "resume" });
    const queue = state.rows.filter(
      (r) =>
        (r.lookup.state === "idle" || (!only && r.lookup.state === "failed")) &&
        (!only || r.entry.kind === only),
    );
    for (const row of queue) {
      if (stop.current) break;
      const index = row.entry.index;
      dispatch({ type: "lookupStart", index });
      const { data, error } = await supabase!.functions.invoke(
        "channel-lookup",
        {
          body: {
            workspace_id: homeId,
            query: row.entry.query,
            platform: "youtube",
          },
        },
      );
      if (error) {
        const code = (await lookupCode(error)) || "unexpected";
        dispatch({ type: "lookupFailed", index, code });
        if (code === "quota_exceeded") break;
        continue;
      }
      const parsed = ChannelLookupResponseSchema.safeParse(data);
      if (!parsed.success) {
        dispatch({ type: "lookupFailed", index, code: "invalid_response" });
        continue;
      }
      dispatch({
        type: "lookupDone",
        index,
        // YouTube channels only: the import files nothing else.
        candidates: parsed.data.candidates.filter(
          (c) => (c.platform ?? "youtube") === "youtube",
        ),
      });
    }
    setRunning(null);
  }

  async function runImports() {
    stop.current = false;
    setRunning("import");
    const queue = state.rows.filter(
      (r) => r.outcome.state === "idle" && chosenCandidate(r) !== null,
    );
    for (const row of queue) {
      if (stop.current) break;
      const c = chosenCandidate(row)!;
      const index = row.entry.index;
      dispatch({ type: "importStart", index });
      const { data, error } = await supabase!.rpc("admin_import_channel", {
        p_external: c.external_channel_id,
        p_title: c.title,
        p_handle: c.handle,
        p_platform: "youtube",
      });
      if (error) {
        dispatch({ type: "importFailed", index, code: rpcCode(error) });
        continue;
      }
      const parsed = AdminImportResultSchema.safeParse(data);
      if (!parsed.success)
        dispatch({ type: "importFailed", index, code: "invalid_response" });
      else dispatch({ type: "importDone", index, result: parsed.data });
    }
    setRunning(null);
  }

  const counts = importCounts(state);
  let body: ReactNode;
  if (!admin) body = null;
  else if (demo)
    body = (
      <Card>
        <p data-testid="admin-import-demo">{S.adminImportDemo}</p>
      </Card>
    );
  else if (home.isPending)
    body = <Loading S={S} label={S.pageOpening} shape="ops" />;
  else if (home.isError)
    body = (
      <LoadError
        S={S}
        message={S.serviceUnreachable}
        failure={failureCode("read", home.error)}
        onRetry={() => void home.refetch()}
      />
    );
  else if (!home.data)
    body = (
      <Card>
        <p role="alert">{S.adminImportNoHome}</p>
      </Card>
    );
  else {
    const homeId = home.data;
    const direct = state.rows.filter((r) => r.entry.kind === "direct").length;
    const search = state.rows.length - direct;
    const waiting = state.rows.filter(
      (r) => r.lookup.state === "idle" || r.lookup.state === "failed",
    );
    const waitingSearch = waiting.filter(
      (r) => r.entry.kind === "search",
    ).length;
    const waitingDirect = waiting.length - waitingSearch;
    const searchedAny = state.rows.some(
      (r) => r.entry.kind === "search" && r.lookup.state === "done",
    );
    const pendingUnits = lookupUnits(
      state.rows.filter((r) => r.lookup.state !== "done").map((r) => r.entry),
    );
    body = (
      <section className="db-section admin-import" data-testid="admin-import">
        <Card>
          <label className="admin-import-file">
            <span>{S.adminImportFileLabel}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={running !== null}
              data-testid="admin-import-file"
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) void readFile(f);
                e.currentTarget.value = "";
              }}
            />
          </label>
          <p className="admin-import-hint">{S.adminImportFileHint}</p>
          <p className="admin-import-hint">{S.adminImportCollectionNote}</p>
          {fileError ? (
            <p role="alert" className="admin-import-error">
              {fileError}
            </p>
          ) : null}
        </Card>

        {state.rows.length ? (
          <>
            <Card>
              <p data-testid="admin-import-summary">
                {S.adminImportSummary(state.rows.length, direct, search)}
              </p>
              {pendingUnits > 0 ? (
                <p className="admin-import-hint">
                  {S.adminImportUnits(pendingUnits)}
                </p>
              ) : null}
              {state.duplicates ? (
                <p className="admin-import-hint">
                  {S.adminImportDuplicates(state.duplicates)}
                </p>
              ) : null}
              {state.rejected.length ? (
                <p className="admin-import-hint">
                  {S.adminImportRejected(state.rejected.length)}
                </p>
              ) : null}
              {state.quotaHalted ? (
                <p role="alert" className="admin-import-error">
                  {S.adminImportQuotaHalted}
                </p>
              ) : null}
              <p data-testid="admin-import-progress">
                {S.adminImportProgress(
                  counts.lookedUp,
                  counts.total,
                  counts.confirmed,
                  counts.undecided,
                )}
              </p>
              {counts.created || counts.existing || counts.failed ? (
                <p data-testid="admin-import-done">
                  {S.adminImportDone(
                    counts.created,
                    counts.existing,
                    counts.failed,
                  )}
                </p>
              ) : null}
              <div className="admin-import-actions">
                {running ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      stop.current = true;
                    }}
                  >
                    {S.adminImportStop}
                  </Button>
                ) : (
                  <>
                    {waitingSearch + waitingDirect > 0 ? (
                      <Button
                        data-testid="admin-import-find"
                        onClick={() => void runLookups(homeId)}
                      >
                        {waitingSearch === 0
                          ? S.adminImportVerify(waitingDirect)
                          : state.quotaHalted || searchedAny
                            ? S.adminImportContinue
                            : S.adminImportFindByName(waitingSearch)}
                      </Button>
                    ) : null}
                    <Button
                      data-testid="admin-import-run"
                      disabled={counts.confirmed === 0}
                      onClick={() => void runImports()}
                    >
                      {S.adminImportRun(counts.confirmed)}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => dispatch({ type: "reset" })}
                    >
                      {S.adminImportClear}
                    </Button>
                  </>
                )}
                {running === "import" ? (
                  <span aria-live="polite">{S.adminImportRunning}</span>
                ) : null}
              </div>
            </Card>

            <div className="table-wrap db-admin-wrap">
              <Table data-testid="admin-import-rows">
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>{S.adminImportColRank}</TableHeaderCell>
                    <TableHeaderCell>{S.adminImportColName}</TableHeaderCell>
                    <TableHeaderCell>{S.adminImportColMatch}</TableHeaderCell>
                    <TableHeaderCell>{S.adminImportColResult}</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {state.rows.map((row) => (
                    <ImportRowView
                      key={row.entry.index}
                      row={row}
                      S={S}
                      locked={running !== null}
                      onChoose={(choice) =>
                        dispatch({
                          type: "choose",
                          index: row.entry.index,
                          choice,
                        })
                      }
                      onRetry={() =>
                        dispatch({
                          type: "retryImport",
                          index: row.entry.index,
                        })
                      }
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : null}
      </section>
    );
  }

  return shell(
    <>
      <AdminPageHead title={S.adminImportTitle} lead={S.adminImportLead} />
      {body}
    </>,
  );
}

function ImportRowView({
  row,
  S,
  locked,
  onChoose,
  onRetry,
}: {
  row: ImportRow;
  S: Strings;
  locked: boolean;
  onChoose: (choice: string) => void;
  onRetry: () => void;
}) {
  const { entry, lookup, outcome } = row;
  const settled = outcome.state === "done" || outcome.state === "pending";
  let match: ReactNode;
  if (lookup.state === "idle")
    match =
      entry.kind === "direct" ? S.adminImportQueuedLink : S.adminImportWaiting;
  else if (lookup.state === "pending") match = S.adminImportSearching;
  else if (lookup.state === "failed")
    match = S.adminImportLookupFailed(lookup.code);
  else if (!lookup.candidates.length) match = S.adminImportNotFound;
  else
    match = (
      <fieldset className="admin-import-choices" disabled={locked || settled}>
        <legend className="admin-import-legend">{S.adminImportPick}</legend>
        {lookup.candidates.map((c) => (
          <CandidateChoice
            key={c.external_channel_id}
            candidate={c}
            name={`import-${entry.index}`}
            checked={row.choice === c.external_channel_id}
            onChoose={onChoose}
            S={S}
          />
        ))}
        <label className="admin-import-choice">
          <input
            type="radio"
            name={`import-${entry.index}`}
            checked={row.choice === "skip"}
            onChange={() => onChoose("skip")}
          />
          <span>{S.adminImportSkip}</span>
        </label>
      </fieldset>
    );

  let result: ReactNode = null;
  if (outcome.state === "pending") result = S.adminImportRunning;
  else if (outcome.state === "done")
    result =
      outcome.result.status === "created" ? (
        <Badge tone="success">{S.adminImportCreated}</Badge>
      ) : (
        <Badge tone="neutral">
          {S.adminImportExists(outcome.result.workspace_name)}
        </Badge>
      );
  else if (outcome.state === "failed")
    result = (
      <>
        <Badge tone="danger">{S.adminImportFailed(outcome.code)}</Badge>{" "}
        <Button variant="link" size="sm" disabled={locked} onClick={onRetry}>
          {S.adminImportRetry}
        </Button>
      </>
    );

  return (
    <TableRow data-testid={`admin-import-row-${entry.index}`}>
      <TableCell>{entry.rank ?? entry.index}</TableCell>
      <TableCell>{entry.name}</TableCell>
      <TableCell>{match}</TableCell>
      <TableCell>{result}</TableCell>
    </TableRow>
  );
}

function CandidateChoice({
  candidate: c,
  name,
  checked,
  onChoose,
  S,
}: {
  candidate: ChannelCandidate;
  name: string;
  checked: boolean;
  onChoose: (choice: string) => void;
  S: Strings;
}) {
  return (
    <label className="admin-import-choice">
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={() => onChoose(c.external_channel_id)}
      />
      {c.thumbnail_url ? (
        <img
          src={c.thumbnail_url}
          alt=""
          width={32}
          height={32}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : null}
      <span className="admin-import-candidate">
        <span>{c.title ?? c.handle ?? c.external_channel_id}</span>
        {c.handle ? <small>{c.handle}</small> : null}
      </span>
      <a
        href={`https://www.youtube.com/channel/${c.external_channel_id}`}
        target="_blank"
        rel="noopener noreferrer"
        className="admin-import-open"
      >
        {S.adminImportOpen}
      </a>
    </label>
  );
}
