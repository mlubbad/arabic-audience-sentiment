/** The slice of Google Identity Services this app actually calls. Loaded by
 *  a `<script>` tag at runtime, not a package, so there is no upstream type
 *  package to lean on — this is the minimal surface `googleOneTap.ts` uses. */
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(c: {
            client_id: string;
            callback: (r: { credential?: string }) => void;
            nonce?: string;
            use_fedcm_for_prompt?: boolean;
            cancel_on_tap_outside?: boolean;
            itp_support?: boolean;
          }): void;
          prompt(): void;
          cancel(): void;
        };
      };
    };
  }
}
export {};
