import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  competitorKeys,
  decideCompetitor,
  loadCompetitors,
} from "../api/competitors";
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
