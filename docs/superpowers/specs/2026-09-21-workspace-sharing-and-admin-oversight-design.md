# Workspace Sharing Between Accounts and Platform Admin Oversight (Design)

2026-09-21. Approved in conversation.

## 1. Overview & Business Context

This specification defines two tightly coupled capabilities for multi-account collaboration and administrative governance:
1. **Workspace Sharing Between Accounts (مشاركة المساحات بين الحسابات):**
   - Workspace owners can invite other registered accounts to collaborate on their workspace by email.
   - Collaborating accounts can be assigned either the `analyst` (محلل) or `viewer` (مشاهد) role.
   - Strict enforcement of plan member quotas (`plans.members_limit`).
   - Workspace owners can list shared accounts, change roles, and revoke access at any time.
   - Built on existing primitives (`public.memberships`, `auth.users`, `public.plans`) without introducing external invite modules or redundant tables.
2. **Platform Admin / Manager Oversight (وصول وصلاحية المشاهدة للمدير):**
   - Platform managers (`private.platform_admins` / `public.is_platform_admin()`) possess view and access rights across all member workspaces in the platform.
   - Transparently integrated with RLS policies via `private.has_role(w)`.
   - Clear inspection UX from `/admin` with an unmistakable "Admin Inspection Mode" banner and 1-click return to admin room.

---

## 2. Architecture & Data Model

### 2.1 Reusing Existing Primitives (No New Module)

The database already possesses the core tables needed:
- `public.workspaces`: `(id uuid, name text, created_by uuid references auth.users(id), ...)`
- `public.memberships`: `(workspace_id uuid references workspaces(id), user_id uuid references auth.users(id), role text)`
  - Supported roles: `'workspace_owner'`, `'analyst'`, `'viewer'`
- `public.plans`: has column `members_limit integer`
  - Free: 1 member
  - Creator: 1 member
  - Creator Plus: 2 members
  - Agency: 10 members
  - Media: 25 members
  - Enterprise: 100 members
  - Owner: null (unlimited)
- `private.plan_limit(w, 'members')`: returns the plan's member limit for the workspace.

We add an optional timestamp column to `public.memberships` to track when an account was added:
```sql
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS added_at timestamptz NOT NULL DEFAULT now();
```

---

### 2.2 Server RPCs & Business Rules

All actions are gated behind strict SECURITY DEFINER SQL functions with `search_path = ''`:

#### 1. `public.list_workspace_accounts(w uuid)`
- **Access:** Caller must be a member of workspace `w` (`private.has_role(w)`) or a platform admin (`public.is_platform_admin()`).
- **Logic:** Joins `public.memberships m` with `auth.users u` on `m.user_id = u.id` and `public.workspaces ws` on `ws.id = w`.
- **Returns:** JSON array of accounts:
  ```json
  [
    {
      "user_id": "uuid",
      "email": "user@example.com",
      "role": "workspace_owner | analyst | viewer",
      "is_owner": true,
      "added_at": "ISO string"
    }
  ]
  ```
- **Members Count & Limit:** Returns metadata including total members and the plan's `members_limit`.

#### 2. `public.share_workspace(w uuid, account_email text, account_role text)`
- **Access:** Caller must be `workspace_owner` (`private.has_role(w, array['workspace_owner'])`) or platform admin (`public.is_platform_admin()`).
- **Role Validation:** `account_role` must be in `('analyst', 'viewer')`.
- **Account Lookup:** Searches `auth.users` for matching normalized email (`lower(trim(account_email))`).
  - If not found: raises exception `'user_not_found'` with error code `'42704'`.
- **Duplicate Check:** If the account already has a membership in `w`:
  - If already owner: raises `'cannot_modify_owner'`.
  - If already member with another role: updates the role and audits `account_role_updated`.
- **Quotas Check:**
  - Evaluates current count: `SELECT count(*) FROM public.memberships WHERE workspace_id = w`.
  - Checks against `private.plan_limit(w, 'members')`.
  - If count >= limit: raises exception `'members_limit_reached'` with error code `'EXMEM'`.
- **Action:** Inserts into `public.memberships(workspace_id, user_id, role, added_at)`.
- **Audit:** Records row in `public.audit_events`:
  - `action`: `'workspace_shared'`
  - `actor_id`: `auth.uid()`
  - `workspace_id`: `w`
  - `target_id`: target `user_id`
  - `details`: `jsonb_build_object('email', account_email, 'role', account_role)`

#### 3. `public.unshare_workspace(w uuid, target_user_id uuid)`
- **Access:** Caller must be `workspace_owner` or platform admin.
- **Safety Rule:** Cannot remove the workspace owner (`user_id = workspaces.created_by` or role `workspace_owner`).
  - Raises `'cannot_remove_owner'`.
- **Action:** `DELETE FROM public.memberships WHERE workspace_id = w AND user_id = target_user_id`.
- **Audit:** Records row in `public.audit_events` with `action: 'workspace_unshared'`.

#### 4. `public.update_workspace_account_role(w uuid, target_user_id uuid, new_role text)`
- **Access:** Caller must be `workspace_owner` or platform admin.
- **Validation:** `new_role` in `('analyst', 'viewer')`. Cannot modify owner role.
- **Action:** `UPDATE public.memberships SET role = new_role WHERE workspace_id = w AND user_id = target_user_id`.

---

### 2.3 Platform Admin / Manager RLS & Oversight

To enable platform managers to view and access any member workspace across the entire platform:
Update `private.has_role`:
```sql
CREATE OR REPLACE FUNCTION private.has_role(
  w uuid,
  allowed text[] DEFAULT array['workspace_owner', 'analyst', 'viewer']
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    EXISTS (
      SELECT 1 FROM public.memberships m
      WHERE m.workspace_id = w
        AND m.user_id = (SELECT auth.uid())
        AND m.role = ANY(allowed)
    )
    OR EXISTS (
      SELECT 1 FROM private.platform_admins
      WHERE user_id = (SELECT auth.uid())
    )
  );
$$;
```

**Impact of this change:**
1. All RLS `tenant_read` policies (`workspaces`, `channels`, `videos`, `comments`, `jobs`, `subscriptions`, `usage_events`, `video_selections`) immediately grant access to platform admins.
2. `public.dashboard_snapshot(w)` and `public.workspace_ops_snapshot(w)` execute cleanly for platform admins without errors.
3. Tenant isolation between regular non-admin accounts remains 100% sealed.

---

## 3. User Experience & Frontend Design

### 3.1 Workspace Sharing Dialog in `WorkspaceCard.tsx`
- In `WorkspaceCard.tsx`, beside the existing rename and channel actions:
  - Add button: **«مشاركة المساحة» (Share Workspace)** with user icon.
  - Clicking opens a dedicated modal `ShareWorkspaceDialog`:
    - **Header:** Displays workspace name, current accounts count, and plan limit (e.g., `2 / 10 حسابات`).
    - **List of Accounts:**
      - Shows owner account with badge `المالك` (`workspace_owner`).
      - Shows shared accounts with badge `محلل` (`analyst`) or `مشاهد` (`viewer`).
      - Dropdown to change role or button to revoke access («إلغاء المشاركة») with confirmation.
    - **Add Account Form:**
      - Email input field: `البريد الإلكتروني للحساب`.
      - Role selector: `محلل (Analyst)` or `مشاهد (Viewer)`.
      - Button: `مشاركة المساحة`.
      - Clean error handling (e.g. "هذا البريد غير مسجل في المنصة", "تم بلوغ الحد الأقصى للحسابات في خطتك").

### 3.2 Platform Admin Oversight UX (Best Solution)
1. **In `/admin` (Workspaces Table):**
   - Each row in `WorkspaceRow.tsx` receives a primary action button: **«استعراض المساحة» (Inspect Workspace)**.
   - Clicking it sets the active workspace to that ID and navigates directly to `/dashboard?ws=<workspace_id>`.
2. **Inspection Banner (`AdminInspectionBanner`):**
   - When a platform admin is viewing a workspace they do not own:
   - A distinct, high-clarity announcement banner appears at the top:
     `وضع المشرف: تتصفح مساحة [اسم المساحة] · الحساب المالك: [بريد المالك]`
     مع زر: `العودة للوحة الإدارة` (`/admin`).
3. **Rail Workspace Switcher:**
   - Retains normal workspace list for personal workspaces.
   - When inspecting an account's workspace, shows that workspace with an indicator `(استعراض مشرف)`.
   - Allows switching back to own workspaces effortlessly.

---

## 4. Verification & Testing

1. **Unit & Database Tests (Vitest + PGlite):**
   - `supabase/tests/workspace_sharing.test.ts`:
     - Test adding an account by email: success case.
     - Test role assignment (`analyst` vs `viewer`).
     - Test unshare / remove account.
     - Test non-existent email refusal (`user_not_found`).
     - Test member limit refusal (`members_limit_reached`) on free/creator plans.
     - Test tenant isolation: non-member cannot list or share.
     - Test platform admin access: platform admin can view any workspace data via `private.has_role(w)` and inspect dashboard snapshot.
2. **Frontend Component Tests:**
   - Test `ShareWorkspaceDialog` rendering, role switching, error reporting.
   - Test Admin inspection banner display and navigation back to `/admin`.
3. **Full System Verification:**
   - `npm run check` (lint, format, typecheck, check:functions, test, test:db, worker:test, build, check:secrets).
