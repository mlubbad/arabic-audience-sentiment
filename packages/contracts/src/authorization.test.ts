import { expect, it } from "vitest";
import {
  authorize,
  type IdentityStore,
} from "../../../supabase/functions/_shared/authorization";
const store: IdentityStore = {
  getUser: async (token) =>
    token === "valid" ? { id: "verified-user" } : null,
  getRole: async (user, workspace) =>
    user === "verified-user" && workspace === "allowed" ? "analyst" : null,
};
it("checks identity and current membership independently", async () => {
  await expect(
    authorize(store, "Bearer invalid", "allowed", ["analyst"]),
  ).rejects.toMatchObject({ code: "unauthenticated" });
  await expect(
    authorize(store, "Bearer valid", "other", ["analyst"]),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    authorize(store, "Bearer valid", "allowed", ["workspace_owner"]),
  ).rejects.toMatchObject({ code: "forbidden" });
  await expect(
    authorize(store, "Bearer valid", "allowed", ["analyst"]),
  ).resolves.toEqual({
    user_id: "verified-user",
    workspace_id: "allowed",
    role: "analyst",
  });
});
