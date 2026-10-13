/**
 * The add-by-handle form for one public platform.
 *
 * One form for the five platforms that take a handle or a link: the registry
 * says how to clean the input and what candidate to hand back; the card says
 * which platform is open. Every test id keeps the prefix the per-platform
 * forms carried (`addtelegram-form-…`, `addx-submit-…`, …), so the page's
 * tests and handlers did not move.
 */
import type { ChannelCandidate } from "@sentiment/contracts";
import { useStrings } from "../strings";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { PUBLIC_PLATFORMS, type PublicPlatform } from "./publicPlatforms";

export function PublicHandleForm({
  platform,
  workspaceId,
  pending,
  handle,
  error,
  lookupErrorPresent,
  onHandleChange,
  onErrorChange,
  onSearch,
  onAdd,
  onCancel,
  onClearError,
}: {
  platform: PublicPlatform;
  workspaceId: string;
  pending: boolean;
  /** The typed handle and its validation message; the card holds both so
   *  its own fallback door can reuse what was typed. */
  handle: string;
  error: string | null;
  /** The page is showing a lookup error; typing asks it to clear it. */
  lookupErrorPresent: boolean;
  onHandleChange: (value: string) => void;
  onErrorChange: (error: string | null) => void;
  onSearch: (clean: string) => void;
  onAdd: (candidate: ChannelCandidate) => void;
  onCancel: () => void;
  onClearError: () => void;
}) {
  const S = useStrings();
  const spec = PUBLIC_PLATFORMS[platform];
  const inputId = `${spec.testId}-handle-${workspaceId}`;

  const cleaned = (): string | null => {
    const clean = spec.clean(handle);
    onErrorChange(clean ? null : S[spec.invalid]);
    return clean;
  };

  return (
    <>
      <p>{S[spec.lead]}</p>
      <form
        className="db-ws-rename"
        data-testid={`${spec.testId}-form-${workspaceId}`}
        onSubmit={(e) => {
          e.preventDefault();
          const clean = cleaned();
          if (clean) onSearch(clean);
        }}
      >
        <label htmlFor={inputId}>{S[spec.heading]}</label>
        <Input
          id={inputId}
          name="handle"
          required
          maxLength={200}
          placeholder={S[spec.placeholder]}
          value={handle}
          onChange={(e) => {
            onHandleChange(e.target.value);
            if (error) onErrorChange(null);
            if (lookupErrorPresent) onClearError();
          }}
          autoFocus
        />
        <small className="db-muted db-form-note">
          {S.addDirectAvailableDesc}
        </small>
        <div className="db-actions">
          <Button
            type="submit"
            disabled={pending || !handle.trim()}
            data-testid={`${spec.testId}-search-${workspaceId}`}
          >
            {S.addChannelSearch}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={pending || !handle.trim()}
            data-testid={`${spec.testId}-submit-${workspaceId}`}
            onClick={() => {
              const clean = cleaned();
              if (clean) onAdd(spec.candidate(clean));
            }}
          >
            {S.addDirectAvailable}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            data-testid={`${spec.testId}-close-${workspaceId}`}
            onClick={() => {
              onHandleChange("");
              onErrorChange(null);
              onCancel();
            }}
          >
            {S.addChannelCancel}
          </Button>
        </div>
      </form>
      {error && (
        <p className="db-feedback db-feedback--note" role="status">
          {error}
        </p>
      )}
    </>
  );
}
