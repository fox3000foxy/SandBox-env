import { spawn } from 'node:child_process';
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildBwrapArgs } from './bwrap.js';
import { checkTorProxy, resolveConfig, resolveInterpreter } from './detect.js';
import { buildFirejailArgs } from './firejail.js';
import type { ExecResult, ResolvedConfig, RunOptions, SandboxOptions } from './types.js';

// ─── Sandbox class ────────────────────────────────────────────────────────────

export class Sandbox {
  private readonly opts: SandboxOptions;
  private config: ResolvedConfig | null = null;

  constructor(opts: SandboxOptions = {}) {
    this.opts = opts;
  }

  // ── Lazy init ──────────────────────────────────────────────────────────────

  private async getConfig(): Promise<ResolvedConfig> {
    if (this.config) return this.config;

    const cfg = resolveConfig(this.opts);

    // Verify Tor is reachable if requested
    if (this.opts.tor !== undefined && cfg.tor.verify) {
      await checkTorProxy(cfg.tor);
    }

    this.config = cfg;
    return cfg;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Executes an arbitrary script inside the sandbox.
   *
   * The script is written to a temporary file, executed via the appropriate
   * interpreter, then cleaned up — regardless of success or failure.
   *
   * @example
   * const result = await sandbox.run({
   *   lang: "python3",
   *   code: `import socket; print(socket.gethostname())`,
   * });
   */
  async run(runOpts: RunOptions): Promise<ExecResult> {
    const config = await this.getConfig();
    const interpreter = resolveInterpreter(runOpts.lang);

    // Create a unique temporary directory for this execution
    const tempDir = mkdtempSync(join(tmpdir(), 'sandbox-'));
    try {
      // Add the temporary directory as a writable bind mount
      config.fs.rwBind.push({ host: tempDir, guest: '/sandbox' });

      // Build the command to execute
      const innerCmd = [interpreter, '/sandbox/script'];

      // Execute the sandboxed command
      const result = await this.executeSandbox(config, innerCmd, runOpts);

      return result;
    } finally {
      // Clean up the temporary directory after execution
      rmdirSync(tempDir);
    }
  }

  async executeSandbox(config: ResolvedConfig, innerCmd: string[], runOpts: RunOptions): Promise<ExecResult> {
    const dir = mkdtempSync(join(tmpdir(), 'torbox-'));
    const ext = langToExt(runOpts.lang);
    const scriptPath = join(dir, `script${ext}`);

    writeFileSync(scriptPath, runOpts.code, { encoding: 'utf8', mode: 0o700 });

    const guestScriptPath = scriptPath; // same path, ro-bound below
    const mergedEnv = buildEnv(config, runOpts);

    let outerBin: string;
    let outerArgs: string[];

    if (config.backend === 'bwrap') {
      const augmented: ResolvedConfig = {
        ...config,
        fs: {
          ...config.fs,
          roBind: [...config.fs.roBind, { host: dir, guest: dir }],
        },
      };
      outerBin = config.binPath;
      outerArgs = buildBwrapArgs(augmented, innerCmd);
    } else {
      outerBin = config.binPath;
      outerArgs = buildFirejailArgs(config, innerCmd);
    }

    const timeout = runOpts.timeout ?? config.timeout;
    const torEnabled = this.opts.tor !== undefined;

    try {
      const result = await spawnAndCollect({
        bin: outerBin,
        args: outerArgs,
        env: mergedEnv,
        stdin: runOpts.stdin,
        timeout,
      });

      return {
        ...result,
        backend: config.backend,
        torEnabled,
      };
    } finally {
      tryUnlink(scriptPath);
      tryRmdir(dir);
    }
  }

  async probe(): Promise<{ backend: string; binPath: string }> {
    const cfg = await this.getConfig();
    return { backend: cfg.backend, binPath: cfg.binPath };
  }

  async checkTor(): Promise<void> {
    const cfg = await this.getConfig();
    await checkTorProxy(cfg.tor);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildEnv(config: ResolvedConfig, runOpts: RunOptions): Record<string, string> {
  const base: Record<string, string> = {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: '/home',
    TMPDIR: '/tmp',
    LANG: 'C.UTF-8',
    ...config.env,
    ...runOpts.env,
  };

  // Inject Tor proxy vars if Tor is configured
  if (config.tor) {
    const proxyUrl = `socks5h://${config.tor.host}:${config.tor.port}`;
    base['ALL_PROXY'] = proxyUrl;
    base['HTTPS_PROXY'] = proxyUrl;
    base['HTTP_PROXY'] = proxyUrl;
    base['no_proxy'] = ''; // clear any existing no_proxy
  }

  return base;
}

interface SpawnOptions {
  bin: string;
  args: string[];
  env: Record<string, string>;
  stdin?: string;
  timeout: number;
}

interface SpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

function spawnAndCollect(opts: SpawnOptions): Promise<SpawnResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const chunks = { out: [] as Buffer[], err: [] as Buffer[] };

    const child = spawn(opts.bin, opts.args, {
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (d: Buffer) => chunks.out.push(d));
    child.stderr.on('data', (d: Buffer) => chunks.err.push(d));

    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin, 'utf8');
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`Sandbox timed out after ${opts.timeout}ms`));
    }, opts.timeout);

    child.on('error', err => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn sandbox (${opts.bin}): ${err.message}`));
    });

    child.on('close', code => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? -1,
        stdout: Buffer.concat(chunks.out).toString('utf8'),
        stderr: Buffer.concat(chunks.err).toString('utf8'),
        durationMs: Date.now() - start,
      });
    });
  });
}

function langToExt(lang: string): string {
  return { node: '.mjs', python3: '.py', bash: '.sh', sh: '.sh' }[lang] ?? '';
}

function tryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    /* best-effort */
  }
}

function tryRmdir(path: string): void {
  try {
    // Use sync rmdir — no recursive needed since we only created one file
    import('node:fs').then(({ rmdirSync }) => {
      try {
        rmdirSync(path);
      } catch {
        /* best-effort */
      }
    });
  } catch {
    /* best-effort */
  }
}
