import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Keep TypeScript registration and tests in one process so managed Windows
// runners with a blocked os.userInfo() call can still execute the suite.
await import("./test-bootstrap.mjs");
const { register } = await import("tsx/cjs/api");
register();

const require = createRequire(import.meta.url);
const testFiles = readdirSync(new URL("./", import.meta.url))
  .filter((file) => file.endsWith(".test.ts"))
  .map((file) => fileURLToPath(new URL(`./${file}`, import.meta.url)));

for (const file of testFiles) require(file);
