// Finds or downloads a prebuilt zcash-devtool, and runs it.
// Order: $ZCASH_DEVTOOL, then a cached download, then a fresh download from this package's GitHub release.
// Every download is checked against the sha256 shipped inside the npm package (checksums.json).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const checksums = JSON.parse(readFileSync(new URL("../checksums.json", import.meta.url)));

export const HOME = process.env.ZCASH_TESTNET_WALLET_HOME || join(homedir(), ".zcash-testnet-wallet");
export const assetName = (platform = process.platform, arch = process.arch) =>
  `zcash-devtool-${platform}-${arch}${platform === "win32" ? ".exe" : ""}`;
const releaseUrl = (file) => `https://github.com/anukulpandey/zcash-testnet-wallet/releases/download/v${pkg.version}/${file}`;

export async function devtoolPath(log = () => {}) {
  if (process.env.ZCASH_DEVTOOL) return process.env.ZCASH_DEVTOOL;
  const file = assetName();
  const want = checksums[file];
  if (!want) throw new Error(`No prebuilt zcash-devtool for ${process.platform}-${process.arch} yet. Build it yourself (cargo install --git https://github.com/zcash/zcash-devtool --features qr) and set ZCASH_DEVTOOL=/path/to/zcash-devtool.`);
  const dest = join(HOME, "bin", `${pkg.version}-${file}`);
  if (existsSync(dest)) return dest;

  log(`Downloading zcash-devtool for ${process.platform}-${process.arch} (one time)…`);
  let res;
  try { res = await fetch(releaseUrl(file)); } catch (e) { throw new Error(`Can't download zcash-devtool (${e.cause?.code ?? e.message}). Check your connection.`); }
  if (!res.ok) throw new Error(`Can't download zcash-devtool: HTTP ${res.status} from ${releaseUrl(file)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(buf).digest("hex");
  if (got !== want) throw new Error(`zcash-devtool download failed its checksum (expected ${want}, got ${got}). Not running it.`);
  mkdirSync(join(HOME, "bin"), { recursive: true });
  writeFileSync(dest + ".part", buf, { mode: 0o755 });
  chmodSync(dest + ".part", 0o755);
  renameSync(dest + ".part", dest); // atomic: a half-written file is never picked up
  return dest;
}

// Run `zcash-devtool wallet -w <dir> ...args`. Resolves with stdout, rejects with the last stderr lines.
export const runWallet = (bin, dir, args, input) => new Promise((resolve, reject) => {
  const p = execFile(bin, ["wallet", "-w", dir, ...args], { timeout: 600_000, maxBuffer: 32 << 20 }, (err, stdout, stderr) =>
    err ? reject(new Error((stderr || err.message).replace(/\x1b\[[0-9;]*m/g, "").trim().split("\n").slice(-3).join(" "))) : resolve(stdout));
  p.stdin.end(input ?? ""); // always close stdin: `init` reads an optional seed line from it and would wait forever
});

// `balance --json` prints one JSON line last (zatoshi values, *_spendable per pool, chain_tip_height).
export const parseBalance = (out) => JSON.parse(out.trim().split("\n").pop());
