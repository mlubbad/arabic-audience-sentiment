import type { Session } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

// The catalogue reads and the client are faked so the checkout's decisions
// can be driven without a server: which price is asked for, what Paddle is
// handed, and where it refuses.
const rpc = vi.fn();
vi.mock("./supabase", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));
vi.mock("./data", () => ({ configuredMode: "live", fixtureCatalogue: [] }));
vi.mock("./planCatalogue", () => ({
  readCatalogue: () =>
    Promise.resolve([
      { key: "creator", provider_prices: { month: "pri_m", year: "pri_y" } },
      { key: "media", provider_prices: {} },
    ]),
}));

import { checkoutItems, initPaddle, openCheckout, priceIdFor } from "./paddle";

const session = { user: { id: "u1", email: "a@b.c" } } as Session;

function fakePaddle() {
  const paddle = {
    Environment: { set: vi.fn() },
    Initialize: vi.fn(),
    Checkout: { open: vi.fn() },
  };
  vi.stubGlobal("window", {
    Paddle: paddle,
    location: { origin: "https://app.test" },
  });
  return paddle;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rpc.mockReset();
});

describe("paddle checkout", () => {
  const plan = {
    key: "creator",
    provider_prices: { month: "pri_m", year: "pri_y" },
  };
  it("picks the price for the interval", () => {
    expect(priceIdFor(plan, "month")).toBe("pri_m");
    expect(priceIdFor(plan, "year")).toBe("pri_y");
    expect(
      priceIdFor({ key: "media", provider_prices: {} }, "month"),
    ).toBeNull();
  });
  it("builds the checkout call with the workspace in custom data", () => {
    expect(checkoutItems("pri_m", "w1", "a@b.c", "https://app.test")).toEqual({
      items: [{ priceId: "pri_m", quantity: 1 }],
      customData: { workspace_id: "w1" },
      customer: { email: "a@b.c" },
      settings: { successUrl: "https://app.test/account?checkout=done" },
    });
  });
  it("leaves the customer out when the session carries no email", () => {
    expect(checkoutItems("pri_m", "w1", undefined, "https://app.test")).toEqual(
      {
        items: [{ priceId: "pri_m", quantity: 1 }],
        customData: { workspace_id: "w1" },
        settings: { successUrl: "https://app.test/account?checkout=done" },
      },
    );
  });
});

describe("initPaddle", () => {
  it("refuses without Paddle.js on the page", async () => {
    vi.stubGlobal("window", {});
    vi.stubEnv("VITE_PADDLE_CLIENT_TOKEN", "test_abc");
    await expect(initPaddle()).rejects.toThrow("checkout_unavailable");
  });
  it("refuses without a client token", async () => {
    const paddle = fakePaddle();
    vi.stubEnv("VITE_PADDLE_CLIENT_TOKEN", "");
    await expect(initPaddle()).rejects.toThrow("checkout_unavailable");
    expect(paddle.Initialize).not.toHaveBeenCalled();
  });
  it("sets the environment and initialises once", async () => {
    const paddle = fakePaddle();
    vi.stubEnv("VITE_PADDLE_CLIENT_TOKEN", "test_abc");
    vi.stubEnv("VITE_PADDLE_ENV", "sandbox");
    await initPaddle();
    await initPaddle();
    expect(paddle.Environment.set).toHaveBeenCalledTimes(1);
    expect(paddle.Environment.set).toHaveBeenCalledWith("sandbox");
    expect(paddle.Initialize).toHaveBeenCalledTimes(1);
    expect(paddle.Initialize).toHaveBeenCalledWith({ token: "test_abc" });
  });
});

describe("openCheckout", () => {
  it("opens Paddle's overlay with the plan's price and the workspace", async () => {
    const paddle = fakePaddle();
    vi.stubEnv("VITE_PADDLE_CLIENT_TOKEN", "test_abc");
    await openCheckout({
      planKey: "creator",
      interval: "year",
      session,
      workspaceId: "w1",
    });
    expect(paddle.Checkout.open).toHaveBeenCalledWith(
      checkoutItems("pri_y", "w1", "a@b.c", "https://app.test"),
    );
  });
  it("never opens without a workspace to bill", async () => {
    const paddle = fakePaddle();
    vi.stubEnv("VITE_PADDLE_CLIENT_TOKEN", "test_abc");
    await expect(
      openCheckout({ planKey: "creator", interval: "month", session }),
    ).rejects.toThrow("checkout_unavailable");
    expect(paddle.Checkout.open).not.toHaveBeenCalled();
  });
  it("refuses a plan with no price for the interval", async () => {
    const paddle = fakePaddle();
    vi.stubEnv("VITE_PADDLE_CLIENT_TOKEN", "test_abc");
    await expect(
      openCheckout({
        planKey: "media",
        interval: "month",
        session,
        workspaceId: "w1",
      }),
    ).rejects.toThrow("checkout_unavailable");
    expect(paddle.Checkout.open).not.toHaveBeenCalled();
  });
  it("refuses a plan the catalogue does not carry", async () => {
    fakePaddle();
    vi.stubEnv("VITE_PADDLE_CLIENT_TOKEN", "test_abc");
    await expect(
      openCheckout({
        planKey: "nope",
        interval: "month",
        session,
        workspaceId: "w1",
      }),
    ).rejects.toThrow("checkout_unavailable");
  });
  it("reads the pack's price from addon_catalogue", async () => {
    const paddle = fakePaddle();
    vi.stubEnv("VITE_PADDLE_CLIENT_TOKEN", "test_abc");
    rpc.mockResolvedValue({
      data: [
        {
          key: "pack_10k",
          kind: "comment_analysis",
          units: 10000,
          price_cents: 500,
          provider_prices: { pack: "pri_pack" },
        },
      ],
      error: null,
    });
    await openCheckout({
      planKey: "pack_10k",
      interval: "month",
      session,
      workspaceId: "w1",
    });
    expect(rpc).toHaveBeenCalledWith("addon_catalogue");
    expect(paddle.Checkout.open).toHaveBeenCalledWith(
      checkoutItems("pri_pack", "w1", "a@b.c", "https://app.test"),
    );
  });
  it("refuses the pack before its price is synced", async () => {
    const paddle = fakePaddle();
    vi.stubEnv("VITE_PADDLE_CLIENT_TOKEN", "test_abc");
    rpc.mockResolvedValue({
      data: [
        {
          key: "pack_10k",
          kind: "comment_analysis",
          units: 10000,
          price_cents: 500,
          provider_prices: {},
        },
      ],
      error: null,
    });
    await expect(
      openCheckout({
        planKey: "pack_10k",
        interval: "month",
        session,
        workspaceId: "w1",
      }),
    ).rejects.toThrow("checkout_unavailable");
    expect(paddle.Checkout.open).not.toHaveBeenCalled();
  });
});
