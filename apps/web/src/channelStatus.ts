/**
 * The workspace's channel, as `connection_status` reports it.
 *
 * The source the overview reads carries the sync state but not the channel's
 * own status — whether one is attached, and whether its grant still works —
 * and the setup path's second step is exactly that. One small read, keyed by
 * workspace, live only: the fixture has no channels table and no connection
 * to report on.
 */
import { useQuery } from "@tanstack/react-query";
import type { DataMode } from "./data";
import { supabase } from "./supabase";

export type ChannelStatusRow = { channel_id: string; status: string };

export function useChannelStatus(mode: DataMode, workspaceId: string) {
  return useQuery({
    queryKey: ["connection-status", workspaceId],
    enabled: mode === "live" && !!supabase,
    queryFn: async (): Promise<ChannelStatusRow | null> => {
      const { data, error } = await supabase!
        .from("connection_status")
        .select("channel_id,status")
        .eq("workspace_id", workspaceId);
      if (error) throw new Error("connection_status_unavailable");
      const rows = (data ?? []) as ChannelStatusRow[];
      // A connected channel outranks a seeded or lapsed one in the same
      // workspace: it is the one a collection would run against.
      return rows.find((r) => r.status === "connected") ?? rows[0] ?? null;
    },
  });
}
