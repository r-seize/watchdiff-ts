import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["cjs", "esm"],
    shims: true,
    clean: true,
  },
  {
    entry: { "cli/main": "src/cli/main.ts" },
    format: ["cjs"],
    banner: { js: "#!/usr/bin/env node" },
    shims: true,
  },
]);
