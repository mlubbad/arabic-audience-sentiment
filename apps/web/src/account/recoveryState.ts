/**
 * Did this session come from a password recovery link?
 *
 * The reset page serves two people: one who forgot their password and
 * arrived by the emailed link (the link is their proof, there is no old
 * password to ask for), and one already signed in who opened the page
 * (who must prove the current password first, so a borrowed session cannot
 * lock its owner out). The flag is kept in `sessionStorage` as well as in
 * memory, so a reload between the link and the form does not turn the
 * first person into the second.
 */
const KEY = "aas.recovery";

let recovery = false;

function read(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function write(on: boolean) {
  try {
    if (on) sessionStorage.setItem(KEY, "1");
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the in-memory flag still holds for this load */
  }
}

export function markRecovery() {
  recovery = true;
  write(true);
}

export function clearRecovery() {
  recovery = false;
  write(false);
}

export function isRecoverySession(): boolean {
  return recovery || read();
}
