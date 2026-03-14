// Set minimal env vars so env.ts module loading doesn't call process.exit
process.env.ANTHROPIC_API_KEY ??= "test-key-for-module-load";
