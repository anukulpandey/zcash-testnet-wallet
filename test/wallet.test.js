import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { incoming, newEvents, memoText } from "../lib/watch.js";

const cli = new URL("../bin/zcash-testnet-wallet.js", import.meta.url).pathname;
const fake = new URL("./fake-devtool.sh", import.meta.url).pathname;
const run = (...args) => execFileSync(process.execPath, [cli, ...args], {
  env: { ...process.env, ZCASH_DEVTOOL: fake, ZCASH_TESTNET_WALLET_HOME: mkdtempSync(join(tmpdir(), "ztw-")), NO_COLOR: "1" }, encoding: "utf8",
});

test("creates a wallet and prints address, QR and balance", () => {
  const out = run("--no-fund");
  assert.match(out, /Wallet created/);
  assert.match(out, /Address\s+utest1fakeaddress000/);
  assert.match(out, /█▀▀▀█ QR/);
  assert.match(out, /Balance 0\.1 TAZ \(0 TAZ spendable\)/);
});

test("viewkey prints only the UFVK on stdout", () => {
  const home = mkdtempSync(join(tmpdir(), "ztw-"));
  const env = { ...process.env, ZCASH_DEVTOOL: fake, ZCASH_TESTNET_WALLET_HOME: home, NO_COLOR: "1" };
  execFileSync(process.execPath, [cli, "--no-fund"], { env });
  assert.equal(execFileSync(process.execPath, [cli, "viewkey"], { env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(), "uviewtest1fakekey");
  assert.ok(existsSync(join(home, "wallet", "data.sqlite")));
});

test("memoText decodes ZIP 302 text memos", () => {
  const m = new Uint8Array(512); m.set(Buffer.from("order-42"));
  assert.equal(memoText(m), "order-42");
  assert.equal(memoText(Uint8Array.of(0xf6, ...new Uint8Array(511))), null);
});

test("watcher fires mined then confirmed, once per txid, filtered by memo", () => {
  const file = join(mkdtempSync(join(tmpdir(), "ztw-")), "data.sqlite");
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE v_transactions (txid BLOB, mined_height INTEGER);
           CREATE TABLE v_tx_outputs (txid BLOB, value INTEGER, memo BLOB, to_account_uuid BLOB, from_account_uuid BLOB, is_change INTEGER);`);
  const memo = (s) => { const m = new Uint8Array(512); m.set(Buffer.from(s)); return m; };
  const tx = (b) => new Uint8Array(32).fill(b);
  db.prepare("INSERT INTO v_transactions VALUES (?, ?)").run(tx(1), 100);
  db.prepare("INSERT INTO v_transactions VALUES (?, ?)").run(tx(2), 101);
  db.prepare("INSERT INTO v_transactions VALUES (?, ?)").run(tx(3), null);      // unmined
  db.prepare("INSERT INTO v_tx_outputs VALUES (?, 5000, ?, x'01', NULL, 0)").run(tx(1), memo("order-42"));
  db.prepare("INSERT INTO v_tx_outputs VALUES (?, 7000, ?, x'01', NULL, 0)").run(tx(1), memo("order-42")); // 2nd output, same tx
  db.prepare("INSERT INTO v_tx_outputs VALUES (?, 9000, ?, x'01', NULL, 0)").run(tx(2), memo("other"));
  db.prepare("INSERT INTO v_tx_outputs VALUES (?, 1000, ?, x'01', x'01', 1)").run(tx(1), memo("order-42")); // change
  db.prepare("INSERT INTO v_tx_outputs VALUES (?, 3000, ?, x'01', NULL, 0)").run(tx(3), memo("order-42"));
  db.close();

  const seen = new Set();
  const opts = { memo: "order-42", confirmations: 3 };
  let ev = newEvents(incoming(file, 101), opts, seen);           // 2 confirmations
  assert.deepEqual(ev.map((e) => [e.stage, e.zat, e.confirmations]), [["mined", 12000, 2]]);
  assert.equal(ev[0].txid, "01".repeat(32));
  assert.deepEqual(newEvents(incoming(file, 101), opts, seen), []); // no repeat
  ev = newEvents(incoming(file, 102), opts, seen);               // 3 confirmations
  assert.deepEqual(ev.map((e) => e.stage), ["confirmed"]);
  assert.equal(newEvents(incoming(file, 200), { memo: null, confirmations: 3 }, new Set()).length, 4); // tx1+tx2, mined+confirmed
});
