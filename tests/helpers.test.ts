import { describe, it, expect } from "vitest";
import {
  generateRequestId,
  sleep,
  parseBoolean,
  maskSensitiveData,
} from "../src/utils/helpers.js";

describe("helpers", () => {
  it("generates unique request ids", () => {
    const a = generateRequestId();
    const b = generateRequestId();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });

  it("sleeps for roughly the requested time", async () => {
    const start = Date.now();
    await sleep(40);
    expect(Date.now() - start).toBeGreaterThanOrEqual(35);
  });

  it("parses truthy strings", () => {
    expect(parseBoolean("true")).toBe(true);
    expect(parseBoolean("1")).toBe(true);
    expect(parseBoolean("YES")).toBe(true);
    expect(parseBoolean("false")).toBe(false);
    expect(parseBoolean(undefined)).toBe(false);
  });

  it("masks sensitive keys", () => {
    const masked = maskSensitiveData({
      username: "alice",
      password: "hunter2",
      authToken: "abc",
    });
    expect(masked.username).toBe("alice");
    expect(masked.password).toBe("***");
    expect(masked.authToken).toBe("***");
  });
});
