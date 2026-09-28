// Plain object, no import: vitest is hoisted above backend/node_modules, so a
// `defineConfig` import here fails to resolve.
//
// Every suite runs against a throwaway DATA_DIR, never the live one.
// userGroupRepo.test.js wipes all tiers in its beforeEach; if DATA_DIR pointed
// at the running instance's data, `vitest run` would silently delete the real
// tok/usr tiers and recreate them from fixture values. Env is set here, before
// any module reads DATA_DIR at import time.
//
// The throwaway directory is resolved relative to this file so the config works
// on any machine; override it with TEST_DATA_DIR if you want it elsewhere.
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export default {
  test: {
    env: {
      DATA_DIR: process.env.TEST_DATA_DIR || path.join(here, "..", ".test-data"),
    },
    include: ["src/**/*.test.js", "open-sse/test/**/*.test.js"],
  },
};
