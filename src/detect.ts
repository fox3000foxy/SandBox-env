import { execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
import type { ResolvedConfig, SandboxBackend, SandboxOptions, TorOptions } from './types.js';

// ─── Binary detection ────────────────────────────────────────────────────────

function which(bin: string): string | null {
  try {
    const result = execFileSync('which', [bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return result.trim() || null;
  } catch {
    return null;
  }
}

export function detectBackend(preference: SandboxBackend): {
  backend: 'bwrap' | 'firejail';
  binPath: string;
} {
  const candidates: Array<'bwrap' | 'firejail'> = preference === 'auto' ? ['bwrap', 'firejail'] : preference === 'bwrap' ? ['bwrap'] : ['firejail'];

  for (const name of candidates) {
    const bin = which(name);
    if (bin) return { backend: name, binPath: bin };
  }

  const tried = candidates.join(', ');
  throw new Error(`No sandbox backend found (tried: ${tried}).\n` + 'Install one with:\n' + '  sudo apt install bubblewrap   # bwrap\n' + '  sudo apt install firejail     # firejail');
}

// ─── Tor connectivity check ──────────────────────────────────────────────────

export function checkTorProxy(opts: Required<TorOptions>): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: opts.host, port: opts.port }, () => {
      socket.destroy();
      resolve();
    });
    socket.setTimeout(3000);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error(`Tor SOCKS5 proxy unreachable at ${opts.host}:${opts.port}.\n` + 'Make sure Tor is running: sudo systemctl start tor'));
    });
    socket.on('error', err => {
      reject(new Error(`Cannot connect to Tor SOCKS5 at ${opts.host}:${opts.port}: ${err.message}`));
    });
  });
}

// ─── Config resolver ─────────────────────────────────────────────────────────

export function resolveConfig(opts: SandboxOptions): ResolvedConfig {
  const { backend, binPath } = detectBackend(opts.backend ?? 'auto');

  const tor: Required<TorOptions> = {
    host: opts.tor?.host ?? '127.0.0.1',
    port: opts.tor?.port ?? 9050,
    verify: opts.tor?.verify ?? true,
  };

  const fs = {
    roBind: opts.fs?.roBind ?? [],
    rwBind: opts.fs?.rwBind ?? [],
    tmpfs: opts.fs?.tmpfs ?? true,
  };

  return {
    backend,
    binPath,
    tor,
    fs,
    timeout: opts.timeout ?? 30_000,
    env: opts.env ?? {},
    cwd: opts.cwd ?? '/tmp',
  };
}

// ─── Interpreter resolver ────────────────────────────────────────────────────

export function resolveInterpreter(lang: string): string {
  const map: Record<string, string> = {
    node: 'node',
    python3: 'python3',
    bash: 'bash',
    sh: 'sh',
  };
  const bin = map[lang];
  if (!bin) throw new Error(`Unsupported language: "${lang}"`);

  const found = which(bin);
  if (!found) throw new Error(`Interpreter not found: "${bin}" (for lang "${lang}")`);
  return found;
}
