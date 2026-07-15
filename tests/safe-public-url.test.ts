import { describe, expect, it } from "vitest";
import { assertSafePublicHttpUrl } from "@/lib/safe-public-url";

describe("public URL guard", () => {
  it.each([
    "http://127.0.0.1/admin",
    "http://10.0.0.8/private",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "http://localhost:3000/",
    "file:///etc/passwd",
    "https://user:pass@example.com/",
  ])("rejects unsafe URL %s", async (url) => {
    await expect(assertSafePublicHttpUrl(url)).rejects.toThrow();
  });
});
