import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("UsagePage Error Analysis Tab registration", () => {
  it("registers errorAnalysis tab and imports ErrorAnalysisTab component", () => {
    const file = fs.readFileSync(
      path.resolve(__dirname, "../../src/app/(dashboard)/dashboard/usage/page.js"),
      "utf8"
    );
    expect(file).toContain('import ErrorAnalysisTab from "./components/ErrorAnalysisTab"');
    expect(file).toContain('{ value: "errorAnalysis", label: "Error Analysis (429/410)" }');
    expect(file).toContain('{activeTab === "errorAnalysis" && <ErrorAnalysisTab />}');
  });
});
