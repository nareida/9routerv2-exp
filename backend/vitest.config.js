// Plain object, no import: vitest is hoisted above backend/node_modules, so a
// `defineConfig` import here fails to resolve.
//
// Every suite runs against a throwaway DATA_DIR, never the live one.
// userGroupRepo.test.js wipes all tiers in its beforeEach; if DATA_DIR pointed
// at the running instance's data, `vitest run` would silently delete the real
// tok/usr tiers and recreate them from fixture values. Env is set here, before
// any module reads DATA_DIR at import time.
export default {
  test: {
    env: {
      DATA_DIR: "/opt/data/9router-exp/.test-data",
    },
    include: ["src/**/*.test.js", "open-sse/test/**/*.test.js"],
  },
};
