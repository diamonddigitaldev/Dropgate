// Whether this is a test build, for src/dgdtp/noise.ts' __DROPGATE_TEST_BUILD__:
// only a test build lets Noise take a fixed ephemeral key or a lowered rekey
// interval, which known-answer tests need and nothing else may have. Every one
// of core's builds (tsup.config.ts) says false, so that code is never in a
// build; vitest's config and the integration suite's browser bundle of core's
// checks say true. Left undefined (any other bundler), it's false too.

/** esbuild's `define` for `__DROPGATE_TEST_BUILD__`. */
export const testBuildDefine = (testBuild) => ({ __DROPGATE_TEST_BUILD__: testBuild ? 'true' : 'false' });
