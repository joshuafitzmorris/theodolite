import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fixtureFiles, problems, scanFixture, strayFiles } from "./fixtures/scan/harness.ts";

const dir = resolve(import.meta.dirname, "fixtures/scan/py");
const found = scanFixture(dir);

describe("detect: Python fixtures", () => {
	// guards: each numbered fixture file keeps yielding exactly the sites its expect markers declare;
	// the guard sentence in each file's header names the specific failure
	for (const { name, guards } of fixtureFiles(dir)) {
		it(`${name}: ${guards}`, () => {
			expect(problems(dir, name, found)).toEqual([]);
		});
	}

	// guards: test files, __tests__ folders, migrations and .d.ts files being scanned
	it("scans nothing outside the numbered fixtures", () => {
		expect(strayFiles(found)).toEqual([]);
	});

	// guards: the fixture tree shrinking below the 25 positive cases the matrix doc requires
	it("holds at least 25 positive cases", () => {
		const positives = [...found.values()].reduce((n, lines) => n + lines.size, 0);
		expect(positives).toBeGreaterThanOrEqual(25);
	});
});
