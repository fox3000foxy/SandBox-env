/**
 * torbox test suite
 * Run with: npx tsx test/sandbox.test.ts
 *           (or node --experimental-strip-types after Node 22.6+)
 */

import { checkTorProxy, detectBackend } from "./dist/detect.js";
import type { ExecResult } from "./dist/index.js";
import { Sandbox } from "./dist/index.js";

// ─── Minimal test harness ─────────────────────────────────────────────────────

type TestFn = () => Promise<void> | void;
const tests: Array<{ name: string; fn: TestFn }> = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: TestFn) {
  tests.push({ name, fn });
}

async function runAll() {
  console.log("torbox test suite\n" + "─".repeat(50));
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓  ${name}`);
      passed++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗  ${name}\n       ${msg}`);
      failed++;
    }
  }
  console.log("─".repeat(50));
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test("detectBackend finds bwrap or firejail", () => {
  try {
    const { backend, binPath } = detectBackend("auto");
    assert(["bwrap", "firejail"].includes(backend), `unexpected backend: ${backend}`);
    assert(binPath.length > 0, "binPath is empty");
    console.log(`     → using backend: ${backend} (${binPath})`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // On CI / systems without either, skip gracefully
    if (msg.includes("No sandbox backend")) {
      console.log("     → no backend available, skipping");
    } else {
      throw err;
    }
  }
});

test("checkTorProxy rejects when nothing listens on a bogus port", async () => {
  let threw = false;
  try {
    await checkTorProxy({ host: "127.0.0.1", port: 19050, verify: true });
  } catch {
    threw = true;
  }
  assert(threw, "expected an error for unreachable proxy");
});

test("Sandbox.probe() resolves config without running code", async () => {
  let info: { backend: string; binPath: string } | null = null;
  try {
    const sb = new Sandbox({ backend: "auto" });
    info = await sb.probe();
    assert(info.backend.length > 0, "backend empty");
    assert(info.binPath.length > 0, "binPath empty");
    console.log(`     → probed: ${info.backend}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("No sandbox backend")) {
      console.log("     → no backend available, skipping");
    } else {
      throw err;
    }
  }
});

test("Sandbox.run() executes bash echo", async () => {
  let result: ExecResult;
  try {
    const sb = new Sandbox({ backend: "auto", timeout: 10_000 });
    result = await sb.run({ lang: "bash", code: 'echo "hello torbox"' });
    assert(result.exitCode === 0, `expected exit 0, got ${result.exitCode}`);
    assert(result.stdout.includes("hello torbox"), `stdout: ${result.stdout}`);
    assert(result.torEnabled === false, "tor should be disabled");
    console.log(`     → stdout: ${result.stdout.trim()}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("No sandbox backend")) {
      console.log("     → no backend available, skipping");
    } else {
      throw err;
    }
  }
});

test("Sandbox.run() captures stderr", async () => {
  try {
    const sb = new Sandbox({ backend: "auto", timeout: 10_000 });
    const result = await sb.run({
      lang: "bash",
      code: "echo out && echo err >&2",
    });
    assert(result.stdout.trim() === "out", `stdout mismatch: "${result.stdout}"`);
    assert(result.stderr.trim() === "err", `stderr mismatch: "${result.stderr}"`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("No sandbox backend")) {
      console.log("     → no backend available, skipping");
    } else {
      throw err;
    }
  }
});

test("Sandbox.run() enforces timeout", async () => {
  let threw = false;
  try {
    const sb = new Sandbox({ backend: "auto", timeout: 500 });
    await sb.run({ lang: "bash", code: "sleep 5" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("No sandbox backend")) {
      console.log("     → no backend available, skipping");
      return;
    }
    if (msg.includes("timed out")) threw = true;
    else throw err;
  }
  assert(threw, "expected timeout error");
});

test("Sandbox.run() passes env vars", async () => {
  try {
    const sb = new Sandbox({
      backend: "auto",
      timeout: 10_000,
      env: { MY_VAR: "sandbox_level" },
    });
    const result = await sb.run({
      lang: "bash",
      code: "echo $MY_VAR $RUN_VAR",
      env: { RUN_VAR: "run_level" },
    });
    assert(
      result.stdout.includes("sandbox_level") &&
        result.stdout.includes("run_level"),
      `env vars not propagated: "${result.stdout}"`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("No sandbox backend")) {
      console.log("     → no backend available, skipping");
    } else {
      throw err;
    }
  }
});

test("Sandbox.run() with Tor sets proxy env vars (no real Tor needed)", async () => {
  // We set verify:false to skip the TCP check — we only test that the env
  // vars are built correctly by checking via the script itself.
  try {
    const sb = new Sandbox({
      backend: "auto",
      timeout: 10_000,
      tor: { host: "127.0.0.1", port: 9050, verify: false },
    });
    const result = await sb.run({
      lang: "bash",
      code: "echo $ALL_PROXY",
    });
    assert(
      result.stdout.includes("socks5h://127.0.0.1:9050"),
      `ALL_PROXY not set correctly: "${result.stdout}"`
    );
    assert(result.torEnabled === true, "torEnabled should be true");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("No sandbox backend")) {
      console.log("     → no backend available, skipping");
    } else {
      throw err;
    }
  }
});

// ─── Run ──────────────────────────────────────────────────────────────────────

await runAll();
