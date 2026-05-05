export type TestCaseRow = {
	testCaseId: string;
	title: string;
	description: string;
	preconditions: string;
	steps: string;
	expectedResult: string;
	priority: string;
	comments?: string;
};

export type GeneratedTestCases = {
	recommendedTestingFramework: string;
	testCases: TestCaseRow[];
};

/** Suggested automation file from POST /generate-tests */
export type TestScriptSuggestion = {
	framework: string;
	language: string;
	filename: string;
	code: string;
};

export type IntelliGenerationResult = GeneratedTestCases & {
	testScript: TestScriptSuggestion | null;
};
