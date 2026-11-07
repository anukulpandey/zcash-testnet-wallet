#!/usr/bin/env node
// zcash-testnet-wallet: a working Zcash testnet wallet in one command.
// Downloads a prebuilt zcash-devtool, creates a wallet, prints a utest1 address with a QR code,
// funds it from zcash-faucet, and waits until the TAZ shows up.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { HOME, devtoolPath, parseBalance, runWallet } from "../lib/devtool.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const gold = paint("38;5;214"), dim = paint("2"), bold = paint("1"), red = paint("31"), green = paint("32");
const say = (s = "") => console.log(s ? `  ${s}` : "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const taz = (zat) => `${(zat / 1e8).toFixed(8).replace(/\.?0+$/, "")} TAZ`;

const HELP = `
  ${gold("zcash-testnet-wallet")} ${dim("v" + version)}: a Zcash testnet wallet in one command

  ${bold("Usage")}
    npx zcash-testnet-wallet             create a wallet (or reuse yours), show the address + QR, fund it
    npx zcash-testnet-wallet balance     sync and show the balance
    npx zcash-testnet-wallet send <address> <TAZ> [--memo <text>]
    npx zcash-testnet-wallet viewkey     print the wallet's viewing key (for watch, explorers, payment tools)
    npx zcash-testnet-wallet watch --ufvk <key> [--memo <text>] [--confirmations 3] [--birthday <height>]
                                         print one JSON line per payment: when mined, then when confirmed

  ${bold("Options")}
    --no-fund          don't ask the faucet for TAZ
    --server <s>       lightwalletd to use: zecrocks (default) or host:port
    --dir <path>       wallet folder (default ~/.zcash-testnet-wallet/wallet)
    -h, --help · -v, --version

  ${dim("Bring your own build: ZCASH_DEVTOOL=/path/to/zcash-devtool. Testnet only: TAZ has no value.")}
`;

// argv helpers: flag(name) -> bool, opt(name) -> value | undefined
const VALUE_OPTS = ["--server", "--dir", "--ufvk", "--memo", "--confirmations", "--birthday"];
const parse = (argv) => ({
  flag: (n) => argv.includes(n),
  opt: (n) => { const i = argv.indexOf(n); if (i < 0) return undefined; if (!argv[i + 1] || argv[i + 1].startsWith("--")) throw new Error(`${n} needs a value.`); return argv[i + 1]; },
  cmd: argv.find((a, i) => !a.startsWith("-") && !VALUE_OPTS.includes(argv[i - 1])),
});

// `list-addresses` prints "Default Address: utest1…" and, in builds with the qr feature, a QR code under it.
export function parseAddress(out) {
  const lines = out.split("\n");
  const i = lines.findIndex((l) => l.includes("Default Address:"));
  if (i < 0) throw new Error("zcash-devtool didn't print an address.");
  return { address: lines[i].split("Default Address:")[1].trim(), qr: lines.slice(i + 1).filter((l) => l.trim()).join("\n") };
}

async function openWallet(bin, dir, lwd) {
  if (existsSync(join(dir, "data.sqlite"))) return false;
  say(dim("Creating a new testnet wallet (keys stay on this machine)…"));
  // init generates an age identity and stores the seed encrypted to it (it writes that file before creating the dir).
  mkdirSync(dir, { recursive: true });
  await runWallet(bin, dir, ["init", "--name", "testnet", "-i", join(dir, "identity.txt"), "-n", "test", ...lwd]);
  return true;
}

async function balance(bin, dir, lwd) {
  await runWallet(bin, dir, ["sync", ...lwd]);
  const b = parseBalance(await runWallet(bin, dir, ["balance", "--json"]));
  const spendable = Object.entries(b).reduce((s, [k, v]) => (k.endsWith("_spendable") ? s + v : s), 0);
  return { total: b.total ?? 0, spendable, height: b.chain_tip_height };
}

function fund(address) {
  // Reuse zcash-faucet as is (proof-of-work, cooldowns, status), so there's one faucet client to maintain.
  return new Promise((resolve) => {
    const p = spawn("npx", ["-y", "zcash-faucet@latest", address], { stdio: "inherit", shell: process.platform === "win32" });
    p.on("exit", (code) => resolve(code === 0));
    p.on("error", () => resolve(false));
  });
}

async function main(argv) {
  const a = parse(argv);
  if (a.flag("-v") || a.flag("--version")) return console.log(version);
  if (a.flag("-h") || a.flag("--help")) return console.log(HELP);
  const lwd = ["-s", a.opt("--server") ?? "zecrocks"];
  const dir = a.opt("--dir") ?? join(HOME, "wallet");

  if (a.cmd === "watch") {
    const { watchPayments } = await import("../lib/watch.js");
    const ufvk = a.opt("--ufvk");
    if (!ufvk) throw new Error("watch needs --ufvk <viewing key>. Try: npx zcash-testnet-wallet viewkey");
    const ctl = new AbortController();
    process.on("SIGINT", () => ctl.abort());
    console.error(dim(`Watching${a.opt("--memo") ? ` for memo "${a.opt("--memo")}"` : ""}… (Ctrl-C to stop)`));
    return watchPayments({
      ufvk, memo: a.opt("--memo") ?? null, confirmations: +(a.opt("--confirmations") ?? 3), birthday: a.opt("--birthday"),
      server: lwd[1], signal: ctl.signal, log: (m) => console.error(dim(m)), onPayment: (e) => console.log(JSON.stringify(e)),
    });
  }

  const bin = await devtoolPath();

  if (a.cmd === "viewkey") {
    if (!existsSync(join(dir, "data.sqlite"))) throw new Error("No wallet yet. Run: npx zcash-testnet-wallet");
    const out = await runWallet(bin, dir, ["list-accounts"]);
    const birthday = out.match(/birthday height (\d+)/)?.[1];
    if (birthday) console.error(dim(`birthday height ${birthday} (pass --birthday ${birthday} to watch)`));
    return console.log(out.match(/UFVK: (\S+)/)?.[1] ?? "");
  }

  if (a.cmd === "balance") {
    const b = await balance(bin, dir, lwd);
    return say(`${gold("ⓩ")}  ${bold(taz(b.total))} ${dim(`(${taz(b.spendable)} spendable, block ${b.height})`)}`);
  }
  if (a.cmd === "send") {
    const [to, amount] = argv.slice(argv.indexOf("send") + 1);
    const zat = Math.round(Number(amount) * 1e8);
    if (!/^(utest1|ztestsapling1|tm|textest1)/.test(to ?? "") || !(zat > 0)) throw new Error("Usage: npx zcash-testnet-wallet send <testnet-address> <amount-in-TAZ> [--memo <text>]");
    // stdio inherit: zcash-devtool shows the proposal and asks you to confirm.
    const memo = a.opt("--memo") ? ["--memo", a.opt("--memo")] : [];
    const p = spawn(bin, ["wallet", "-w", dir, "send", "-i", join(dir, "identity.txt"), "--address", to, "--value", String(zat), ...memo, ...lwd], { stdio: "inherit" });
    return new Promise((resolve, reject) => p.on("exit", (c) => (c === 0 ? resolve() : reject(new Error("Send failed (see above).")))));
  }
  if (a.cmd) throw new Error(`Unknown command "${a.cmd}". See --help.`);

  say();
  const created = await openWallet(bin, dir, lwd);
  const { address, qr } = parseAddress(await runWallet(bin, dir, ["list-addresses"]));
  say(`${green("✔")} ${created ? "Wallet created" : "Using your wallet"} ${dim(dir)}`);
  say();
  console.log(qr ? qr.replace(/^/gm, "  ") : dim("  (this zcash-devtool build has no QR support)"));
  say();
  say(`${bold("Address")}  ${gold(address)}`);
  say(dim("Unified address with Orchard, Sapling and transparent receivers: any testnet wallet can pay it."));
  say();

  let b = await balance(bin, dir, lwd);
  if (b.total === 0 && !a.flag("--no-fund")) {
    say(bold("Funding it from zcash-faucet…"));
    if (!(await fund(address))) say(red("The faucet didn't pay this time. Your wallet is fine; try again later or use any other faucet."));
    else {
      say(dim("Waiting for the next block (~75s)…"));
      for (let i = 0; i < 24 && b.total === 0; i++) { await sleep(15_000); b = await balance(bin, dir, lwd).catch(() => b); }
    }
  }
  say(`${gold("ⓩ")}  Balance ${bold(taz(b.total))} ${dim(`(${taz(b.spendable)} spendable)`)}`);
  if (b.total > b.spendable) say(dim("New funds become spendable after a few confirmations."));
  say();
  say(bold("Next"));
  say(`balance   npx zcash-testnet-wallet balance`);
  say(`send      npx zcash-testnet-wallet send <utest1…> 0.01 --memo "hi"`);
  say(`watch     npx zcash-testnet-wallet watch --ufvk $(npx zcash-testnet-wallet viewkey)`);
  say(`more      ${dim(`${bin} wallet -w ${dir} --help`)}`);
  say(dim("Testnet only. Never send TAZ to a mainnet address, never reuse this seed for real funds."));
  say();
}

if (process.argv[1] && (import.meta.url === pathToFileURL(process.argv[1]).href || process.argv[1].endsWith("zcash-testnet-wallet"))) {
  main(process.argv.slice(2)).catch((e) => { console.error(`\n  ${red("✖")} ${e.message}\n`); process.exit(1); });
}
