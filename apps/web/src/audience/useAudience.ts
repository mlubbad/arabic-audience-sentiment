import { useQuery } from "@tanstack/react-query";
import {
  audienceKeys,
  loadAudienceChannels,
  loadAvailability,
  loadOverlap,
  loadSharedVideos,
} from "../api/audience";

/** The section exists only with the switch on AND a plan that includes it
 *  (owner, 2026-10-17: not shown on the lower plans). */
export const audienceVisible = (
  a: { switch_on: boolean; plan_allows: boolean } | undefined,
) => a?.switch_on === true && a.plan_allows === true;
export function useAudienceAvailability(workspace: string | null) {
  return useQuery({
    queryKey: audienceKeys.availability(workspace ?? ""),
    queryFn: () => loadAvailability(workspace!),
    enabled: !!workspace,
  });
}
export function useAudienceChannels(workspace: string | null) {
  return useQuery({
    queryKey: audienceKeys.channels(workspace ?? ""),
    queryFn: () => loadAudienceChannels(workspace!),
    enabled: !!workspace,
  });
}
export function useAudienceOverlap(channel: string | null) {
  return useQuery({
    queryKey: audienceKeys.overlap(channel ?? ""),
    queryFn: ({ signal }) => loadOverlap(channel!, signal),
    enabled: !!channel,
  });
}
export function useSharedVideos(channel: string | null, other: string | null) {
  return useQuery({
    queryKey: audienceKeys.videos(channel ?? "", other ?? "", 10),
    queryFn: ({ signal }) => loadSharedVideos(channel!, other!, 10, signal),
    enabled: !!channel && !!other,
  });
}
