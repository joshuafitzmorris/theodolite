import { describe, expect, it } from "vitest";
import { isTestFile } from "../src/scan/walk.ts";

describe("walk: isTestFile", () => {
	// guards: one path rule for tests drifting between the walker and the defaults, so test code gets scanned
	it.each([
		"src/users/service.test.ts",
		"src/users/service.spec.tsx",
		"src/users/test_service.py",
		"src/users/service_test.py",
		"src/conftest.py",
		"test/helpers.ts",
		"src/tests/helpers.py",
		"src/users/__tests__/service.ts",
		"a/b/test/c/d.js",
	])("treats %s as a test file", (path) => {
		expect(isTestFile(path)).toBe(true);
	});

	// guards: names that only contain the word test being skipped, which would hide real writers
	it.each([
		"src/users/service.ts",
		"src/testing/runner.ts",
		"src/contest.py",
		"src/latest/a.js",
		"src/users/test.ts",
		"src/users/attest_helper.py",
	])("keeps %s", (path) => {
		expect(isTestFile(path)).toBe(false);
	});
});
