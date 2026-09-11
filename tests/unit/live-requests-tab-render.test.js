import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("LiveRequestsTab layout check", () => {
  it("does not contain Endpoint table header and renders model badges below", () => {
    const file = fs.readFileSync(
      path.resolve(__dirname, "../../src/app/(dashboard)/dashboard/usage/components/LiveRequestsTab.js"),
      "utf8"
    );
    expect(file).not.toContain('<th className="px-2.5 py-2 border-r border-border max-w-[110px]">Endpoint</th>');
    expect(file).not.toContain('{item.endpoint}');
    expect(file).toContain('break-words');
  });
});
