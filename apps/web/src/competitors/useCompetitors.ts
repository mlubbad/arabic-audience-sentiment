import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as competitorsApi from "../api/competitors";
import {
  competitorKeys,
  addCompetitorCandidate,
  decideCompetitor,
  loadChannels,
  loadCompetitorBenchmark,
  loadCompetitors,
  loadMyRole,
  lookupChannel,
} from "../api/competitors";
export function useCompetitorIntelligence(
  channel: string | null,
  days: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...competitorKeys.channel(channel ?? ""), "intelligence", days],
    queryFn: ({ signal }) =>
      typeof competitorsApi.loadCompetitorIntelligence === "function"
        ? competitorsApi.loadCompetitorIntelligence(channel!, days, signal)
        : Promise.resolve(null),
    enabled: !!channel && enabled,
  });
}
export function useUpsertCompetitorIntelligence(channel: string | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      candidateExternalId,
      profile,
    }: {
      candidateExternalId: string;
      profile: Parameters<
        typeof competitorsApi.upsertCompetitorIntelligence
      >[2];
    }) =>
      competitorsApi.upsertCompetitorIntelligence(
        channel!,
        candidateExternalId,
        profile,
      ),
    onSettled: () =>
      client.invalidateQueries({
        queryKey: competitorKeys.channel(channel ?? ""),
      }),
  });
}
export function useCompetitorBenchmark(
  channel: string | null,
  days: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...competitorKeys.channel(channel ?? ""), "benchmark", days],
    queryFn: ({ signal }) => loadCompetitorBenchmark(channel!, days, signal),
    enabled: !!channel && enabled,
  });
}
export function useCompetitorChannels(workspaceId: string | null) {
  return useQuery({
    queryKey: competitorKeys.channels(workspaceId ?? ""),
    enabled: !!workspaceId,
    queryFn: () => loadChannels(workspaceId!),
  });
}
export function useMyCompetitorRole(workspaceId: string | null) {
  return useQuery({
    queryKey: competitorKeys.role(workspaceId ?? ""),
    enabled: !!workspaceId,
    queryFn: () => loadMyRole(workspaceId!),
  });
}
export function useAddCompetitorCandidate(channel: string | null) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (candidate: {
      id: string;
      title: string;
      handle: string | null;
    }) => addCompetitorCandidate(channel!, candidate),
    onSettled: () =>
      client.invalidateQueries({
        queryKey: competitorKeys.channel(channel ?? ""),
      }),
  });
  return mutation;
}
export function useChannelLookup(
  workspaceId: string | null,
  input: string | null,
) {
  return useQuery({
    queryKey: competitorKeys.lookup(workspaceId ?? "", input ?? ""),
    enabled: !!workspaceId && !!input,
    queryFn: () => lookupChannel(workspaceId!, input!),
  });
}
export function useCompetitors(channel: string | null) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: competitorKeys.channel(channel ?? ""),
    queryFn: ({ signal }) => loadCompetitors(channel!, signal),
    enabled: !!channel,
  });
  const mutation = useMutation({
    mutationFn: ({
      id,
      decision,
    }: {
      id: string;
      decision: "tracked" | "dismissed" | "clear";
    }) => decideCompetitor(channel!, id, decision),
    onSettled: () =>
      client.invalidateQueries({
        queryKey: competitorKeys.channel(channel ?? ""),
      }),
  });
  return { ...query, decide: mutation.mutate, pending: mutation.isPending };
}
