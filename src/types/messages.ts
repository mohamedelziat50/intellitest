export type WebviewMessage =
	| {
			command: 'generate';
			prompt: string;
	  }
	| {
			command: 'generateTestCode';
	  }
	| {
			command: 'exportExcel';
	  }
	| {
			command: 'syncProject';
	  }
	| {
			command: 'ready';
	  }
	| {
			command: 'login';
			email: string;
			password: string;
	  }
	| {
			command: 'signup';
			name: string;
			email: string;
			password: string;
	  }
	| {
			command: 'logout';
	  }
	| {
			command: 'retryAuth';
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
	  }
