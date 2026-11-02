import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("..", import.meta.url));
async function child(operation: string, cleanup: string, duration = 20) {
  const source = `import { runWithObservationShutdown } from './src/app/observationShutdown.ts';
    await runWithObservationShutdown(${operation}, ${cleanup}, ${duration}, 30);`;
  const processHandle = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  processHandle.stderr.on("data", (chunk) => { output += chunk; });
  const watchdog = setTimeout(() => processHandle.kill(), 5000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => { processHandle.on("exit", resolve); processHandle.on("error", reject); });
    return { code, output };
  } finally { clearTimeout(watchdog); }
}

test("CLI force-exits with failure when an operation never settles", async () => {
  const result = await child("async () => new Promise(() => {})", "async () => {}");
  assert.equal(result.code, 1); assert.match(result.output, /cleanup exceeded/);
});
test("CLI force-exits with failure when SDK cleanup never settles", async () => {
  const result = await child("async () => {}", "async () => new Promise(() => {})", 1000);
  assert.equal(result.code, 1); assert.match(result.output, /cleanup exceeded/);
});
test("CLI clears guards after successful work and cleanup", async () => {
  const result = await child("async () => {}", "async () => {}", 1000);
  assert.equal(result.code, 0); assert.equal(result.output, "");
});
