/**
 * Ctrl+K (⌘K on a Mac) in the owner console: one box that finds a page, a
 * channel or an account by name, so a hundred workspaces are never scrolled
 * through (owner console plan, phase 1).
 *
 * A channel opens its workspace's dashboard (`/dashboard?ws=`); an account
 * opens its account file (`/admin/users?u=`); a page is a page. The lists are
 * the admin pages' own reads, fetched when the box first opens and shared
 * with those pages through the query cache.
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useStrings, type StringKey } from "../strings";
import { Button } from "../ui/Button";
import { Dialog, DialogContent, DialogTitle } from "../ui/Dialog";
import { Input } from "../ui/Input";
import { readAdminChannels, readAdminUsers } from "./adminRead";

export type PaletteItem = {
  group: "pages" | "channels" | "users";
  label: string;
  detail?: string;
  to: string;
};

const PAGES: { to: string; key: StringKey }[] = [
  { to: "/admin", key: "adminTabHome" },
  { to: "/admin/workspaces", key: "adminTabWorkspaces" },
  { to: "/admin/users", key: "adminTabUsers" },
  { to: "/admin/channels", key: "adminTabChannels" },
  { to: "/admin/compare", key: "adminTabCompare" },
  { to: "/admin/system", key: "adminTabSystem" },
  { to: "/admin/plans", key: "adminTabPlans" },
  { to: "/admin/ops", key: "adminTabOps" },
  { to: "/admin/services", key: "adminTabServices" },
  { to: "/admin/audit", key: "adminTabAudit" },
  { to: "/admin/import", key: "adminTabImport" },
];

/** Case- and accent-blind enough for names typed in a hurry: lower case, and
 *  Arabic letter forms that readers type interchangeably folded together. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ً-ْـ]/g, "");
}

/** The items that match every word of the query, pages first, at most 40. */
export function matchItems(items: PaletteItem[], query: string): PaletteItem[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return items.filter((i) => i.group === "pages");
  return items
    .filter((i) => {
      const hay = fold(`${i.label} ${i.detail ?? ""}`);
      return words.every((w) => hay.includes(w));
    })
    .slice(0, 40);
}

export function AdminCommandPalette() {
  const S = useStrings();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const channels = useQuery({
    queryKey: ["admin", "channels"],
    queryFn: readAdminChannels,
    enabled: open,
  });
  const users = useQuery({
    queryKey: ["admin", "users", "live"],
    queryFn: readAdminUsers,
    enabled: open,
  });

  const items = useMemo<PaletteItem[]>(
    () => [
      ...PAGES.map((p) => ({
        group: "pages" as const,
        label: S[p.key],
        to: p.to,
      })),
      ...(channels.data ?? []).map((c) => ({
        group: "channels" as const,
        label: c.title ?? c.handle ?? c.external_channel_id,
        detail: [c.handle, c.workspace_name].filter(Boolean).join(" · "),
        to: `/dashboard?ws=${c.workspace_id}`,
      })),
      ...(users.data ?? []).map((u) => ({
        group: "users" as const,
        label: u.email ?? u.id,
        to: `/admin/users?u=${u.id}`,
      })),
    ],
    [S, channels.data, users.data],
  );
  const found = matchItems(items, query);
  const loading = open && (channels.isPending || users.isPending);

  function go(item: PaletteItem | undefined) {
    if (!item) return;
    setOpen(false);
    setQuery("");
    navigate(item.to);
  }
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, found.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(found[active]);
    }
  }
  const groupLabel = {
    pages: S.adminSearchPages,
    channels: S.adminSearchChannels,
    users: S.adminSearchUsers,
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="admin-search-open"
        onClick={() => setOpen(true)}
        data-testid="admin-search-open"
      >
        {S.adminSearchOpen} <kbd dir="ltr">Ctrl K</kbd>
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <DialogContent
          closeLabel={S.adminSearchClose}
          className="admin-search"
          aria-describedby={undefined}
          data-testid="admin-search"
        >
          <DialogTitle>{S.adminSearchTitle}</DialogTitle>
          <Input
            autoFocus
            type="search"
            role="combobox"
            aria-expanded="true"
            aria-controls="admin-search-list"
            aria-activedescendant={
              found[active] ? `admin-search-${active}` : undefined
            }
            aria-label={S.adminSearchTitle}
            placeholder={S.adminSearchPlaceholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          {loading && (
            <p className="admin-account-muted">{S.adminSearchLoading}</p>
          )}
          {found.length === 0 && !loading ? (
            <p className="admin-account-muted">{S.adminSearchEmpty}</p>
          ) : (
            <ul
              id="admin-search-list"
              role="listbox"
              className="admin-search-list"
            >
              {found.map((item, i) => (
                <li
                  key={`${item.group}-${item.to}-${i}`}
                  id={`admin-search-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? "admin-search-active" : undefined}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => go(item)}
                >
                  <span className="admin-search-group">
                    {groupLabel[item.group]}
                  </span>
                  <span dir="auto">{item.label}</span>
                  {item.detail && (
                    <small className="admin-account-muted" dir="auto">
                      {item.detail}
                    </small>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
