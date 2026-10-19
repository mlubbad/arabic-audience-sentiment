import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useSession, useWorkspaces } from "../session";
import { useStrings } from "../strings";
import { toast } from "../ui/Toast";
import { EmptyState, Loading, LoadError } from "../pageStates/PageStates";
import { Labelled } from "../ui/Labelled";
import { SelectItem } from "../ui/Select";
import { Button } from "../ui/Button";
import { BudgetMeter } from "../ui/BudgetMeter";
import { CandidateCard } from "./CandidateCard";
import { AddCompetitor } from "./AddCompetitor";
import {
  useAddCompetitorCandidate,
  useChannelLookup,
  useCompetitorChannels,
  useCompetitors,
  useMyCompetitorRole,
} from "./useCompetitors";
import "./competitors.css";

export function CompetitorsPage() {
  const S = useStrings(),
    { session } = useSession(),
    { workspaces } = useWorkspaces(session);
  const [params, setParams] = useSearchParams();
  const ws = params.get("ws") || workspaces[0]?.id || null;
  const channels = useCompetitorChannels(session ? ws : null);
  const channel = params.get("channel") || channels.data?.[0]?.id || null;
  const query = useCompetitors(channel);
  const addCandidate = useAddCompetitorCandidate(channel);
  const roleQuery = useMyCompetitorRole(session ? ws : null);
  const canEdit =
    roleQuery.data === "workspace_owner" || roleQuery.data === "analyst";
  const [lookupInput, setLookupInput] = useState<string | null>(null);
  const [resolved, setResolved] = useState<{
    id: string;
    title: string;
    handle: string | null;
  } | null>(null);
  const lookup = useChannelLookup(ws, lookupInput);
  const adding = addCandidate.isPending;
  const [addError, setAddError] = useState<string | null>(null);
  // Inline, not in the toast: ToastHost renders outside the router.
  const [limitHit, setLimitHit] = useState(false);
  useEffect(() => {
    if (lookup.data) setResolved(lookup.data);
  }, [lookup.data]);
  useEffect(() => {
    if (lookup.error) setAddError(lookup.error.message);
  }, [lookup.error]);
  if (!session)
    return (
      <main className="competitors-page">
        <EmptyState
          kind="workspace"
          S={S}
          title={S.titleCompetitors}
          lead={S.compDemo}
        />
      </main>
    );
  if (channels.isPending) return <Loading S={S} />;
  if (channels.isError)
    return (
      <LoadError
        S={S}
        failure="channels_failed"
        onRetry={() => void channels.refetch()}
      />
    );
  if (!channels.data?.length)
    return (
      <EmptyState
        kind="workspace"
        S={S}
        title={S.compNoChannel}
        lead={S.compNoChannel}
      />
    );
  const data = query.data;
  function searchCandidate(input: string) {
    setAddError(null);
    setResolved(null);
    setLookupInput(input);
  }
  async function addResolved() {
    if (!resolved || !channel) return;
    try {
      await addCandidate.mutateAsync(resolved);
      setResolved(null);
      setLookupInput(null);
      await query.refetch();
    } catch (error) {
      setAddError(
        error instanceof Error
          ? error.message
          : "competitor_candidate_add_failed",
      );
    }
  }
  return (
    <main className="competitors-page">
      <header>
        <h1>{S.titleCompetitors}</h1>
        <Labelled
          id="competitor-channel"
          label={S.compChoose}
          value={channel ?? ""}
          onValueChange={(value) => {
            params.set("channel", value);
            setParams(params);
          }}
        >
          {channels.data.map((c) => (
            <SelectItem value={c.id} key={c.id}>
              {c.title || c.id}
            </SelectItem>
          ))}
        </Labelled>
      </header>
      {query.isPending ? (
        <Loading S={S} />
      ) : query.isError ? (
        <p role="alert">
          {query.error.message === "no_active_plan"
            ? S.compNoPlan
            : `${S.compError}: ${query.error.message}`}
        </p>
      ) : (
        data && (
          <>
            <section className="competitor-source">
              <h2>
                {data.channel.title || data.channel.handle || data.channel.id}
              </h2>
              <p>
                {S.compFromYoutube}: {S.compSubscribers}{" "}
                {data.channel.subscriber_count == null
                  ? "—"
                  : data.channel.subscriber_count}
              </p>
              {data.channel.profile_observed_at && (
                <p>{data.channel.profile_observed_at}</p>
              )}
              <BudgetMeter
                used={data.tracked_count}
                allowance={data.limit ?? -1}
                state={
                  data.limit != null && data.tracked_count >= data.limit
                    ? "exhausted"
                    : "ok"
                }
                label={S.compTracked}
                sentence={`${S.compTracked}: ${data.tracked_count} ${S.compOf} ${data.limit == null ? S.compUnlimited : data.limit}`}
              />
              {limitHit && data.limit != null && (
                <p role="alert">
                  {S.compLimitLead(data.limit)}{" "}
                  <Link to="/pricing">{S.compSeePlans}</Link>
                </p>
              )}
            </section>
            <section>
              <h2>{S.compSuggestions}</h2>
              {canEdit && (
                <>
                  <AddCompetitor onAdd={searchCandidate} />
                  {resolved && (
                    <div role="dialog" aria-label={S.compAdd}>
                      <p>{resolved.title}</p>
                      <Button
                        disabled={adding}
                        onClick={() => void addResolved()}
                      >
                        {S.compAdd}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => setResolved(null)}
                      >
                        {S.addChannelCancel}
                      </Button>
                    </div>
                  )}
                  {addError && (
                    <p role="alert">
                      {S.compError}: {addError}
                    </p>
                  )}
                </>
              )}
              {!data.candidates.length ? (
                <p>{S.compEmpty}</p>
              ) : (
                data.candidates.map((x) => (
                  <CandidateCard
                    key={x.external_id}
                    item={x}
                    canEdit={canEdit}
                    pending={query.pending}
                    act={(decision) =>
                      query.decide(
                        { id: x.external_id, decision },
                        {
                          onError: (e) => {
                            const limit =
                              e.message === "competitor_limit_reached";
                            setLimitHit(limit);
                            toast({
                              title: limit ? S.compLimitError : S.compError,
                              description: limit ? undefined : e.message,
                            });
                          },
                        },
                      )
                    }
                  />
                ))
              )}
            </section>
          </>
        )
      )}
    </main>
  );
}
