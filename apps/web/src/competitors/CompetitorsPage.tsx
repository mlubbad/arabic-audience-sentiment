import { useState } from "react";
import { useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../supabase";
import { useSession, useWorkspaces } from "../session";
import { useStrings } from "../strings";
import { toast } from "../ui/Toast";
import { EmptyState, Loading, LoadError } from "../pageStates/PageStates";
import { CandidateCard } from "./CandidateCard";
import { AddCompetitor } from "./AddCompetitor";
import { useCompetitors } from "./useCompetitors";
import "./competitors.css";
export function CompetitorsPage() {
  const S = useStrings(),
    { session } = useSession(),
    { workspaces } = useWorkspaces(session);
  const [params, setParams] = useSearchParams();
  const ws = params.get("ws") || workspaces[0]?.id || null;
  const channels = useQuery({
    queryKey: ["competitor-channels", ws],
    enabled: !!ws && !!supabase,
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("channels")
        .select("id,title,subscriber_count,view_count,video_count,platform")
        .eq("workspace_id", ws!)
        .eq("platform", "youtube");
      if (error) throw error;
      return data;
    },
  });
  const channel = params.get("channel") || channels.data?.[0]?.id || null;
  const query = useCompetitors(channel);
  const roleQuery = useQuery({
    queryKey: ["competitor-role", ws],
    enabled: !!ws && !!supabase,
    queryFn: async () => {
      const { data, error } = await supabase!
        .from("memberships")
        .select("role")
        .eq("workspace_id", ws!)
        .eq("user_id", session!.user.id)
        .maybeSingle();
      if (error) throw error;
      return data?.role;
    },
  });
  const canEdit =
    roleQuery.data === "workspace_owner" || roleQuery.data === "analyst";
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
  const [resolved, setResolved] = useState<{
    id: string;
    title: string;
    handle: string | null;
  } | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  async function searchCandidate(input: string) {
    setAddError(null);
    const { data: result, error } = await supabase!.functions.invoke(
      "channel-lookup",
      { body: { workspace_id: ws, query: input, platform: "youtube" } },
    );
    if (error) {
      setAddError(error.message);
      return;
    }
    const candidate = (
      result as {
        candidates?: {
          external_id: string;
          title: string;
          handle?: string | null;
        }[];
      }
    )?.candidates?.[0];
    if (!candidate) {
      setAddError("channel_lookup_empty");
      return;
    }
    setResolved({
      id: candidate.external_id,
      title: candidate.title,
      handle: candidate.handle ?? null,
    });
  }
  async function addResolved() {
    if (!resolved || !channel) return;
    setAdding(true);
    const { error } = await supabase!.rpc("competitor_candidate_add", {
      p_channel: channel,
      p_external: resolved.id,
      p_title: resolved.title,
      p_handle: resolved.handle,
    });
    setAdding(false);
    if (error) {
      setAddError(
        error.message.match(
          /forbidden|invalid_candidate|invalid_input|candidate_limit_reached/,
        )?.[0] ?? "competitor_candidate_add_failed",
      );
      return;
    }
    setResolved(null);
    await query.refetch();
  }
  return (
    <main className="competitors-page">
      <header>
        <h1>{S.titleCompetitors}</h1>
        <label>
          {S.compChoose}
          <select
            value={channel ?? ""}
            onChange={(e) => {
              params.set("channel", e.target.value);
              setParams(params);
            }}
          >
            {channels.data.map((c) => (
              <option value={c.id} key={c.id}>
                {c.title || c.id}
              </option>
            ))}
          </select>
        </label>
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
                  : data.channel.subscriber_count}{" "}
                · {S.compViews}{" "}
                {data.channel.view_count == null
                  ? "—"
                  : data.channel.view_count}{" "}
                · {S.compVideos}{" "}
                {data.channel.video_count == null
                  ? "—"
                  : data.channel.video_count}
              </p>
              <p>
                {S.compTracked}: {data.tracked_count} /{" "}
                {data.limit == null ? S.compUnlimited : data.limit}
              </p>
            </section>
            <section>
              <h2>{S.compSuggestions}</h2>
              {canEdit && (
                <>
                  <AddCompetitor
                    onAdd={(input) => void searchCandidate(input)}
                  />
                  {resolved && (
                    <div role="dialog" aria-label={S.compAdd}>
                      <p>{resolved.title}</p>
                      <button
                        disabled={adding}
                        onClick={() => void addResolved()}
                      >
                        {S.compAdd}
                      </button>
                      <button onClick={() => setResolved(null)}>
                        {S.addChannelCancel}
                      </button>
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
                          onError: (e) =>
                            toast({
                              title:
                                e.message === "competitor_limit_reached"
                                  ? S.compLimitError
                                  : S.compError,
                              description:
                                e.message === "competitor_limit_reached"
                                  ? `${data.limit} · /pricing`
                                  : e.message,
                            }),
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
