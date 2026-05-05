export type WebviewMessage =
	| {
			command: 'generate';
			prompt: string;
	  }
	| {
			command: 'exportExcel';
	  }
	| {
			command: 'ready';
	  }
	| {
			command: 'refreshCodeInsights';
	  }
	| {
			command: 'copyTestScript';
			code: string;
	  }
	| {
			command: 'saveTestScript';
			filename: string;
			code: string;
	  };
