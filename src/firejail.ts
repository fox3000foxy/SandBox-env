import type { ResolvedConfig } from "./types.js";

/**
 * Builds the firejail(1) argument list for the given config.
 *
 * Isolation applied:
 *   - seccomp default profile
 *   - All capabilities dropped
 *   - Private /tmp
 *   - No root
 *   - Network kept (we need localhost:9050 for Tor SOCKS5)
 *   - Custom bind mounts as --bind / --bind-ro
 */
export function buildFirejailArgs(
  config: ResolvedConfig,
  command: string[]
): string[] {
  const args: string[] = [
    "--quiet",
    "--caps.drop=all",
    "--noroot",
    "--seccomp",
    "--private-tmp",
    "--nosound",
    "--nodvd",
    "--notv",
    "--nou2f",
    "--nonewprivs",
  ];

  // ── User-defined bind mounts ──────────────────────────────────────────────
  for (const { host, guest } of config.fs.roBind) {
    args.push(`--bind-try=${host},${guest}`);
  }
  for (const { host, guest } of config.fs.rwBind) {
    args.push(`--bind-try=${host},${guest}`);
  }

  // ── Working dir ───────────────────────────────────────────────────────────
  args.push(`--chdir=${config.cwd}`);

  args.push("--", ...command);
  return args;
}
