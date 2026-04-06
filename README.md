# torbox

Isolated sandbox executor with optional Tor SOCKS5 routing.  
Zero runtime dependencies — uses `bubblewrap` or `firejail` available on the host.

## Install

```bash
# System deps (one of)
sudo apt install bubblewrap   # recommended
sudo apt install firejail

# Optional: Tor
sudo apt install tor && sudo systemctl start tor

# Module
npm install torbox
```

## Quick start

```ts
import { Sandbox } from "torbox";

// Basic sandbox — no Tor
const sb = new Sandbox();

const result = await sb.run({
  lang: "python3",
  code: `
import os, socket
print("hostname:", socket.gethostname())
print("user:", os.getenv("USER", "none"))
  `,
});

console.log(result.stdout);
// hostname: sandbox
// user: none

// With Tor routing
const tor = new Sandbox({
  tor: { host: "127.0.0.1", port: 9050 },
});

const check = await tor.run({
  lang: "python3",
  code: `
import urllib.request, json
res = urllib.request.urlopen("https://check.torproject.org/api/ip", timeout=15)
print(json.load(res))
  `,
});

console.log(check.stdout); // { IP: "...", IsTor: true }
```

## API

### `new Sandbox(opts?)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `backend` | `"bwrap" \| "firejail" \| "auto"` | `"auto"` | Isolation backend |
| `tor` | `TorOptions` | — | Enables Tor routing |
| `tor.host` | `string` | `"127.0.0.1"` | SOCKS5 host |
| `tor.port` | `number` | `9050` | SOCKS5 port |
| `tor.verify` | `boolean` | `true` | Check Tor is reachable on init |
| `fs.roBind` | `Array<{host, guest}>` | `[]` | Extra read-only bind mounts |
| `fs.rwBind` | `Array<{host, guest}>` | `[]` | Extra read-write bind mounts |
| `timeout` | `number` | `30000` | Max execution time (ms) |
| `env` | `Record<string,string>` | `{}` | Extra env vars |
| `cwd` | `string` | `"/tmp"` | Working dir inside sandbox |

### `sandbox.run(opts): Promise<ExecResult>`

| Option | Type | Description |
|--------|------|-------------|
| `lang` | `"node" \| "python3" \| "bash" \| "sh"` | Interpreter |
| `code` | `string` | Script source |
| `stdin` | `string` | Optional stdin |
| `env` | `Record<string,string>` | Per-run env override |
| `timeout` | `number` | Per-run timeout override |

Returns `ExecResult`:

```ts
{
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  backend: "bwrap" | "firejail";
  torEnabled: boolean;
}
```

### `sandbox.probe(): Promise<{ backend, binPath }>`

Resolves config and returns the active backend without executing anything.

### `sandbox.checkTor(): Promise<void>`

Verifies Tor SOCKS5 is reachable. Throws if not.

## Isolation model

### bubblewrap (`bwrap`) — recommended

- New user, PID, UTS, IPC namespaces
- Read-only bind of `/usr`, `/lib`, `/bin`, `/sbin`
- `tmpfs` on `/tmp` and `/home`
- Network namespace **not** isolated by default (needed for `127.0.0.1:9050`)
- `seccomp` via bwrap defaults

### firejail

- All capabilities dropped
- `seccomp` default profile
- Private `/tmp`
- No new privileges

### Tor routing

When `tor` is set, the sandbox receives:

```
ALL_PROXY=socks5h://127.0.0.1:9050
HTTPS_PROXY=socks5h://127.0.0.1:9050
HTTP_PROXY=socks5h://127.0.0.1:9050
```

`socks5h://` — the `h` means DNS is also resolved through Tor (no local DNS leaks).

## Advanced: full network isolation with veth pair

For complete network isolation (sandbox can only reach Tor, nothing else), see the
[veth POC](./docs/veth-isolation.md).

## Limitations

- Linux only (namespaces are a Linux kernel feature)
- The process running the sandbox needs permission to use `bwrap` (usually fine on modern distros)
- Tor must be started separately (`systemctl start tor`)
- No Node.js `vm` module isolation — this is OS-level, not JS-level
