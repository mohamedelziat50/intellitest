export type CodeInsightFunction = {
	name: string;
	signature: string; // e.g., "(password: string, minLength: number): boolean"
	description?: string; // From JSDoc @summary or first line of comment
};

export type CodeInsightClass = {
	name: string;
	methods: string[];
};

export type CodeInsightFile = {
	filePath: string;
	functions: CodeInsightFunction[]; // Now includes semantic info
	variables: string[];
	classes: CodeInsightClass[];
	imports: string[];
};

export type CodeInsightsPayload = {
	files: CodeInsightFile[];
	totalAnalyzedFiles: number;
};
