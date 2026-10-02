import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { supabase } from "./supabase";
import { toast } from "./ui/Toast";
import { useStrings } from "./strings";
import { selectWorkspace } from "./workspaceSelection";
import type { AdminUser } from "@sentiment/contracts";

const STORAGE_KEY = "sentiment_impersonation_session";

export type ImpersonatedTarget = {
  id: string;
  email: string | null;
};

export type ImpersonationContextType = {
  isImpersonating: boolean;
  impersonatedUser: ImpersonatedTarget | null;
  startImpersonation: (
    user: AdminUser | { id: string; email: string | null },
  ) => Promise<void>;
  stopImpersonation: () => Promise<void>;
  loading: boolean;
};

const ImpersonationContext = createContext<ImpersonationContextType>({
  isImpersonating: false,
  impersonatedUser: null,
  startImpersonation: async () => {},
  stopImpersonation: async () => {},
  loading: false,
});

function isDemoMode(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("demo");
}

export function ImpersonationProvider({ children }: { children: ReactNode }) {
  const S = useStrings();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [impersonatedUser, setImpersonatedUser] =
    useState<ImpersonatedTarget | null>(() => {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.id === "string") {
          return { id: parsed.id, email: parsed.email ?? null };
        }
      } catch {
        // storage unavailable or corrupt
      }
      return null;
    });
  const [loading, setLoading] = useState(false);

  const startImpersonation = useCallback(
    async (user: AdminUser | { id: string; email: string | null }) => {
      setLoading(true);
      try {
        const isDemo = isDemoMode();
        if (!supabase && !isDemo) {
          console.error("Cannot impersonate without Supabase client");
          toast({ title: S.adminImpersonateError });
          setLoading(false);
          return;
        }

        if (supabase) {
          const { error } = await supabase.rpc("admin_start_impersonation", {
            p_target_user_id: user.id,
          });
          if (error) {
            console.error("Failed to audit impersonation start:", error);
            toast({ title: S.adminImpersonateError });
            setLoading(false);
            return;
          }
        }

        const target: ImpersonatedTarget = {
          id: user.id,
          email: user.email ?? null,
        };

        try {
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(target));
        } catch {
          // ignore
        }

        setImpersonatedUser(target);
        await queryClient.invalidateQueries();

        // Resolve target user's workspace proactively to avoid falling back to admin's workspace
        let targetWsId: string | null = null;
        if (supabase) {
          try {
            const { data: targetWorkspaces } = await supabase.rpc(
              "my_workspaces",
              { target_user_id: user.id },
            );
            if (
              Array.isArray(targetWorkspaces) &&
              targetWorkspaces.length > 0
            ) {
              targetWsId = targetWorkspaces[0].id;
            }
          } catch {
            // ignore
          }
        }

        if (targetWsId) {
          selectWorkspace(user.id, targetWsId);
          toast({ title: S.adminImpersonateStarting });
          navigate(
            isDemo
              ? `/dashboard?demo=1&ws=${targetWsId}`
              : `/dashboard?ws=${targetWsId}`,
          );
        } else {
          toast({ title: S.adminImpersonateStarting });
          navigate(isDemo ? "/dashboard?demo=1" : "/dashboard");
        }
      } catch (e) {
        console.error("Error during startImpersonation:", e);
        toast({ title: S.adminImpersonateError });
      } finally {
        setLoading(false);
      }
    },
    [navigate, queryClient, S],
  );

  const stopImpersonation = useCallback(async () => {
    setLoading(true);
    const isDemo = isDemoMode();
    try {
      if (!supabase && !isDemo) {
        console.error("Cannot stop impersonation without Supabase client");
        toast({ title: S.adminImpersonateError });
        setLoading(false);
        return;
      }

      if (supabase && impersonatedUser) {
        const { error } = await supabase.rpc("admin_stop_impersonation", {
          p_target_user_id: impersonatedUser.id,
        });
        if (error) {
          console.error("Failed to audit impersonation stop:", error);
          toast({ title: S.adminImpersonateError });
          setLoading(false);
          return;
        }
      }
    } catch (e) {
      console.error("Error during stopImpersonation audit:", e);
      toast({ title: S.adminImpersonateError });
      setLoading(false);
      return;
    }

    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setImpersonatedUser(null);
    await queryClient.invalidateQueries();
    toast({ title: S.adminImpersonateStopping });
    navigate(isDemo ? "/admin/users?demo=1" : "/admin/users");
    setLoading(false);
  }, [impersonatedUser, navigate, queryClient, S]);

  return (
    <ImpersonationContext.Provider
      value={{
        isImpersonating: impersonatedUser !== null,
        impersonatedUser,
        startImpersonation,
        stopImpersonation,
        loading,
      }}
    >
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  return useContext(ImpersonationContext);
}
