// ─── Sandbox options ─────────────────────────────────────────────────────────

export type SandboxBackend = 'bwrap' | 'firejail' | 'auto';

export interface TorOptions {
  /** Host of the running Tor SOCKS5 proxy (default: 127.0.0.1) */
  host?: string;
  /** Port of the running Tor SOCKS5 proxy (default: 9050) */
  port?: number;
  /** Whether to verify Tor is reachable before running (default: true) */
  verify?: boolean;
}

export interface FilesystemOptions {
  /** Read-only host paths to bind-mount into the sandbox */
  roBind?: Array<{ host: string; guest: string }>;
  /** Read-write host paths to bind-mount into the sandbox */
  rwBind?: Array<{ host: string; guest: string }>;
  /** Whether to expose /tmp as tmpfs (default: true) */
  tmpfs?: boolean;
}

export interface SandboxOptions {
  /**
   * Which isolation backend to use.
   * "auto" tries bwrap first, then firejail. (default: "auto")
   */
  backend?: SandboxBackend;

  /** Tor SOCKS5 proxy settings. Omit to disable Tor routing. */
  tor?: TorOptions;

  /** Filesystem isolation options */
  fs?: FilesystemOptions;

  /** Maximum execution time in milliseconds (default: 30_000) */
  timeout?: number;

  /** Additional environment variables injected into the sandbox */
  env?: Record<string, string>;

  /** Working directory inside the sandbox (default: /tmp) */
  cwd?: string;
}

// ─── Execution ───────────────────────────────────────────────────────────────

export type ScriptLanguage = 'node' | 'python3' | 'bash' | 'sh';

export interface RunOptions {
  /** Language / interpreter for the script */
  lang: ScriptLanguage;
  /** Script source code to execute */
  code: string;
  /** Optional stdin to pipe into the process */
  stdin?: string;
  /** Per-run env vars (merged over sandbox-level env) */
  env?: Record<string, string>;
  /** Per-run timeout override (ms) */
  timeout?: number;
}

export interface ExecResult {
  /** Exit code of the sandboxed process */
  exitCode: number;
  /** Captured stdout */
  stdout: string;
  /** Captured stderr */
  stderr: string;
  /** Wall-clock duration in milliseconds */
  durationMs: number;
  /** Which backend was actually used */
  backend: SandboxBackend;
  /** Whether traffic was routed through Tor */
  torEnabled: boolean;
}

// ─── Internal ────────────────────────────────────────────────────────────────

export interface ResolvedConfig {
  backend: 'bwrap' | 'firejail';
  binPath: string;
  tor: Required<TorOptions>;
  fs: Required<FilesystemOptions>;
  timeout: number;
  env: Record<string, string>;
  cwd: string;
}
