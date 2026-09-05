import { describe, expect, it } from "vitest";
import { BaseError, UserRejectedRequestError } from "viem";
import { humanizeError } from "./errors";

describe("humanizeError", () => {
  it("gives a short message for a user-rejected signature/transaction", () => {
    const err = new BaseError("rejected", { cause: new UserRejectedRequestError(new Error("User rejected the request.")) });
    expect(humanizeError(err)).toBe("Rejected in wallet.");
  });

  it("falls back to a plain Error's message", () => {
    expect(humanizeError(new Error("Supply collateral before borrowing."))).toBe("Supply collateral before borrowing.");
  });

  it("has a generic fallback for a non-Error thrown value", () => {
    expect(humanizeError("just a string")).toBe("Something went wrong.");
  });
});
