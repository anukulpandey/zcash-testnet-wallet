// Finds the prebuilt zcash-devtool, and runs it.
// The binary ships in a per-platform npm package (zcash-testnet-wallet-<os>-<cpu>), listed as an
// optionalDependency: npm installs only the one matching your machine, and checks its integrity hash.
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

export const HOME = process.env.ZCASH_TESTNET_WALLET_HOME || join(homedir(), ".zcash-testnet-wallet");
export const platformPackage = (platform = process.platform, arch = process.arch) => `zcash-testnet-wallet-${platform}-${arch}`;

export async function devtoolPath() {
  if (process.env.ZCASH_DEVTOOL) return process.env.ZCASH_DEVTOOL;
  const exe = process.platform === "win32" ? "zcash-devtool.exe" : "zcash-devtool";
  try {
    return createRequire(import.meta.url).resolve(`${platformPackage()}/bin/${exe}`);
  } catch {
    throw new Error(`No prebuilt zcash-devtool for ${process.platform}-${process.arch} yet. Build it yourself:\n    cargo install --git https://github.com/zcash/zcash-devtool --features qr zcash-devtool\n  then run with ZCASH_DEVTOOL=$(which zcash-devtool)`);
  }
}

// Run `zcash-devtool wallet -w <dir> ...args`. Resolves with stdout, rejects with the last stderr lines.
export const runWallet = (bin, dir, args, input) => new Promise((resolve, reject) => {
  const p = execFile(bin, ["wallet", "-w", dir, ...args], { timeout: 600_000, maxBuffer: 32 << 20 }, (err, stdout, stderr) =>
    err ? reject(new Error((stderr || err.message).replace(/\x1b\[[0-9;]*m/g, "").trim().split("\n").slice(-3).join(" "))) : resolve(stdout));
  p.stdin.end(input ?? ""); // always close stdin: `init` reads an optional seed line from it and would wait forever
});

// `balance --json` prints one JSON line last (zatoshi values, *_spendable per pool, chain_tip_height).
export const parseBalance = (out) => JSON.parse(out.trim().split("\n").pop());
