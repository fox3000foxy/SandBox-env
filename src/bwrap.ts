import type { ResolvedConfig } from "./types.js";

/**
 * Builds the bwrap(1) argument list for the given config.
 *
 * Isolation applied:
 *   - New user, pid, uts, ipc namespaces
 *   - Read-only bind mounts of /usr /lib /lib64 /bin /sbin
 *   - tmpfs on /tmp and /home
 *   - proc and devtmpfs
 *   - No network namespace by default (keeps access to 127.0.0.1 for Tor)
 *   - Custom ro/rw bind mounts from config
 */
export function buildBwrapArgs(
  config: ResolvedConfig,
  command: string[]
): string[] {
  const args: string[] = [];

  // ── Standard ro system paths ─────────────────────────────────────────────
  const roPaths = ["/usr", "/lib", "/lib64", "/bin", "/sbin", "/etc/resolv.conf"];
  for (const p of roPaths) {
    args.push("--ro-bind-try", p, p);
  }

  // ── proc / dev ────────────────────────────────────────────────────────────
  args.push("--proc", "/proc");
  args.push("--dev", "/dev");

  // ── tmpfs mounts ──────────────────────────────────────────────────────────
  if (config.fs.tmpfs) {
    args.push("--tmpfs", "/tmp");
    args.push("--tmpfs", "/home");
  }

  // ── User-defined bind mounts ──────────────────────────────────────────────
  for (const { host, guest } of config.fs.roBind) {
    args.push("--ro-bind", host, guest);
  }
  for (const { host, guest } of config.fs.rwBind) {
    args.push("--bind", host, guest);
  }

  // ── Isolation flags ───────────────────────────────────────────────────────
  args.push(
    "--unshare-user",   // new user namespace
    "--unshare-pid",    // new pid namespace
    "--unshare-uts",    // new hostname namespace
    "--unshare-ipc",    // new IPC namespace
    // NOT --unshare-net: we need localhost:9050 (Tor SOCKS5)
    "--die-with-parent",
    "--new-session",
    "--hostname", "sandbox"
  );

  // ── Working dir ───────────────────────────────────────────────────────────
  args.push("--chdir", config.cwd);

  args.push("--", ...command);
  return args;
}
