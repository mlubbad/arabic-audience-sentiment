import { useSearchParams } from "react-router";
import { useSession, useWorkspaces } from "../session";
import { useStrings } from "../strings";
import { useLocale } from "../locale";
import { displayDate } from "../i18n";
import { n } from "../dashboard/format";
import { EmptyState, Loading, LoadError } from "../pageStates/PageStates";
import { Labelled } from "../ui/Labelled";
import { SelectItem } from "../ui/Select";
import {
  useAudienceAvailability,
  useAudienceChannels,
  useAudienceOverlap,
  useSharedVideos,
} from "./useAudience";
import { OverlapTable } from "./OverlapTable";
import { Venn } from "./Venn";
import { BridgeVideos } from "./BridgeVideos";
import "./audience.css";

export function AudiencePage() {
  const S = useStrings();
  const lang = useLocale();
  const { session } = useSession();
  const { workspaces } = useWorkspaces(session);
  const [params, setParams] = useSearchParams();
  const workspace = params.get("ws") || workspaces[0]?.id || null;
  const availability = useAudienceAvailability(session ? workspace : null);
  const channels = useAudienceChannels(session ? workspace : null);
  const channel = params.get("channel") || channels.data?.[0]?.id || null;
  const overlap = useAudienceOverlap(channel);
  const selectedId = params.get("other") || null;
  const selected =
    overlap.data?.others.find((row) => row.channel_id === selectedId) ??
    overlap.data?.others[0] ??
    null;
  const videos = useSharedVideos(channel, selected?.channel_id ?? null);
  if (!session)
    return (
      <main className="audience-page">
        <EmptyState
          kind="workspace"
          S={S}
          title={S.titleAudience}
          lead={S.audienceDemo}
        />
      </main>
    );
  if (!workspace)
    return (
      <main className="audience-page">
        <p>{S.audienceNoOther}</p>
      </main>
    );
  if (availability.isPending) return <Loading S={S} />;
  if (availability.isError)
    return (
      <LoadError
        S={S}
        failure="channels_failed"
        onRetry={() => void availability.refetch()}
      />
    );
  if (!availability.data.switch_on || !availability.data.plan_allows)
    return (
      <main className="audience-unavailable">
        <h1>{S.audienceUnavailable}</h1>
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
  if (!channel || !channels.data?.length)
    return (
      <main className="audience-page">
        <p>{S.audienceNoOther}</p>
      </main>
    );
  return (
    <main className="audience-page">
      <header>
        <h1>{S.titleAudience}</h1>
        <Labelled
          id="audience-channel"
          label={S.audienceChoose}
          value={channel}
          onValueChange={(value) => {
            params.set("channel", value);
            setParams(params);
          }}
        >
          {channels.data.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.title || item.id}
            </SelectItem>
          ))}
        </Labelled>
      </header>
      {overlap.isPending ? (
        <Loading S={S} />
      ) : overlap.isError ? (
        <p role="alert">
          {S.audienceError}: {overlap.error.message}
        </p>
      ) : (
        overlap.data && (
          <>
            {overlap.data.status === "pending" ? (
              <p role="status">{S.audiencePending}</p>
            ) : (
              <>
                <section className="audience-panel">
                  <h2>
                    {overlap.data.channel.title || overlap.data.channel.id}
                  </h2>
                  <p>
                    {S.audienceEngaged}:{" "}
                    {overlap.data.channel.audience_size == null ? (
                      "—"
                    ) : (
                      <>
                        {S.audienceOurCalculation}:{" "}
                        {n(overlap.data.channel.audience_size)}
                      </>
                    )}
                  </p>
                  <p>
                    {S.audienceComputed}:{" "}
                    {displayDate(overlap.data.computed_at, lang)}
                  </p>
                  <p>{S.audienceWorkspaceOnly}</p>
                </section>
                {!overlap.data.others.length ? (
                  <p>{S.audienceNoOther}</p>
                ) : (
                  <OverlapTable
                    data={overlap.data}
                    selected={selected?.channel_id ?? null}
                    onSelect={(id) => {
                      params.set("other", id);
                      setParams(params);
                    }}
                    lang={lang}
                    S={S}
                  />
                )}
                {overlap.data.others.length > 0 &&
                  overlap.data.others.every((row) => row.below_threshold) && (
                    <p>{S.audienceAllBelow}</p>
                  )}
                {selected && (
                  <>
                    <Venn
                      mine={overlap.data.channel.audience_size}
                      row={selected}
                      lang={lang}
                      S={S}
                    />
                    <BridgeVideos data={videos.data} lang={lang} S={S} />
                  </>
                )}
              </>
            )}
          </>
        )
      )}
    </main>
  );
}
