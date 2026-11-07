// Payment watcher: give it a viewing key (and optionally the memo you expect), get one event per
// transaction when it is mined, and one more when it has enough confirmations.
// It keeps a view-only zcash-devtool wallet, syncs it, and reads the wallet's own SQLite views.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HOME, devtoolPath, parseBalance, runWallet } from "./devtool.js";

// ZIP 302 memo: 0xF6 = empty, first byte <= 0xF4 = UTF-8 text padded with zeros, anything else = not text.
export function memoText(bytes) {
  if (!bytes?.length || bytes[0] > 0xf4) return null;
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return Buffer.from(bytes.subarray(0, end)).toString("utf8");
}

// Incoming payments in the wallet DB, one entry per txid (outputs summed). Change and self-transfers are skipped.
export function incoming(dbFile, tip) {
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const rows = db.prepare(`SELECT o.txid, o.value, o.memo, t.mined_height FROM v_tx_outputs o
      JOIN v_transactions t ON t.txid = o.txid
      WHERE o.to_account_uuid IS NOT NULL AND o.from_account_uuid IS NULL AND o.is_change = 0`).all();
    const byTx = new Map();
    for (const r of rows) {
      const txid = Buffer.from(r.txid).reverse().toString("hex"); // stored in internal byte order
      const p = byTx.get(txid) ?? { txid, zat: 0, memos: [], height: r.mined_height ?? null };
      p.zat += Number(r.value);
      const m = memoText(r.memo);
      if (m && !p.memos.includes(m)) p.memos.push(m);
      byTx.set(txid, p);
    }
    return [...byTx.values()].map((p) => ({ ...p, confirmations: p.height && tip ? tip - p.height + 1 : 0 }));
  } finally { db.close(); }
}

// Decide which events to fire now. `seen` holds "<txid>:<stage>" keys already fired (mutated).
export function newEvents(payments, { memo, confirmations }, seen) {
  const out = [];
  for (const p of payments) {
    if (memo != null && !p.memos.includes(memo)) continue;
    const stages = [];
    if (p.confirmations >= 1) stages.push("mined");
    if (p.confirmations >= confirmations) stages.push("confirmed");
    for (const stage of stages) {
      const key = `${p.txid}:${stage}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ stage, txid: p.txid, zat: p.zat, taz: p.zat / 1e8, memos: p.memos, height: p.height, confirmations: p.confirmations });
    }
  }
  return out;
}

export async function watchPayments({ ufvk, memo = null, confirmations = 3, birthday, server = "zecrocks", intervalS = 30, dir, onPayment, signal, log = () => {} }) {
  if (!ufvk) throw new Error("watchPayments needs a viewing key (ufvk).");
  dir ??= join(HOME, "watch-" + createHash("sha256").update(ufvk).digest("hex").slice(0, 12));
  const bin = await devtoolPath();
  const lwd = ["-s", server];
  if (!existsSync(join(dir, "data.sqlite"))) {
    log("Importing the viewing key (view-only wallet, it can't spend)…");
    await runWallet(bin, dir, ["init-fvk", "--name", "watch", "--fvk", ufvk, ...(birthday ? ["--birthday", String(birthday)] : []), ...lwd]);
  }
  // Persist what already fired, so a restart never fires the same txid twice.
  const seenFile = join(dir, "seen.json");
  const seen = new Set(existsSync(seenFile) ? JSON.parse(readFileSync(seenFile, "utf8")) : []);

  while (!signal?.aborted) {
    try {
      await runWallet(bin, dir, ["sync", ...lwd]);
      const tip = parseBalance(await runWallet(bin, dir, ["balance", "--json"])).chain_tip_height;
      const events = newEvents(incoming(join(dir, "data.sqlite"), tip), { memo, confirmations }, seen);
      if (events.length) writeFileSync(seenFile, JSON.stringify([...seen]));
      for (const e of events) await onPayment?.(e);
    } catch (e) {
      log(`sync failed, retrying: ${e.message}`);
    }
    await new Promise((r) => { const t = setTimeout(r, intervalS * 1000); signal?.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true }); });
  }
}
