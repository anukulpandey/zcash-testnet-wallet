<div align="center">

**A working Zcash testnet wallet in one command.**

![node](https://img.shields.io/badge/node-%3E%3D22.13-339933)
![deps](https://img.shields.io/badge/dependencies-0-brightgreen)
![network](https://img.shields.io/badge/network-testnet%20only-f4b728)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

</div>

```bash
npx zcash-testnet-wallet
```

No Rust, no 30-minute build. It downloads a prebuilt [zcash-devtool](https://github.com/zcash/zcash-devtool) for your machine, creates a testnet wallet, prints a `utest1` address **with a QR code**, funds it from [zcash-faucet](https://github.com/anukulpandey/zcash-faucet), and shows your balance.

A real run on testnet (QR trimmed):

```
  ✔ Wallet created ~/.zcash-testnet-wallet/wallet

  ████ ▄▄▄▄▄ ██▄█▄▀▀█ ▀▄▄█▀  █▀ █▄█▀ ▀▀▄▀▄█▀ ▀▀ ▄▀▄██▀▀██  █ ▄▄▄▄▄ ████
  ████ █   █ █ ▀▀██▄ █▀▀ ▄█▀▀█▄  ▄█▀▄▀ ▄██▄▀█▄█▀ ▀▄ ██ █ ▄ █ █   █ ████
  ████ █▄▄▄█ █ █▀▀ ▀  ██▄ ▀▄██ ▄█▄ ▄▄▄ ▄█▀▀▀█▄▄▀ ▀▄▄  ▀  ▄██ █▄▄▄█ ████
  …                                     ← scan it with any testnet wallet

  Address  utest1kqynmm95ru8r2jd86wu08s6jfc4pgxyla8ku8806…0nqfaa
  Unified address with Orchard, Sapling and transparent receivers: any testnet wallet can pay it.

  Funding it from zcash-faucet…
  ✔ Proof-of-work done (3,351 hashes in 12.9s, no account needed)
  ⓩ  0.1 TAZ on its way to utest1kqynmm95…0nqfaa
  txid      2afa604240880eacc631db06235ab1890d4e394621d0457e657bfa4ea7d0b19c

  Waiting for the next block (~75s)…
  ⓩ  Balance 0.1 TAZ (0 TAZ spendable)
  New funds become spendable after a few confirmations.
```

## 🚀 Usage

```bash
npx zcash-testnet-wallet                          # create (or reuse) your wallet, show address + QR, fund it
npx zcash-testnet-wallet balance                  # sync and show the balance
npx zcash-testnet-wallet send <utest1…> 0.01 --memo "hi"
npx zcash-testnet-wallet viewkey                  # your viewing key (UFVK)
npx zcash-testnet-wallet watch --ufvk <key> --memo order-42
```

| Option | What it does |
| --- | --- |
| `--no-fund` | Don't ask the faucet for TAZ |
| `--server <s>` | lightwalletd to use: `zecrocks` (default, testnet.zec.rocks) or `host:port` |
| `--dir <path>` | Wallet folder (default `~/.zcash-testnet-wallet/wallet`) |
| `ZCASH_DEVTOOL=/path` | Use your own zcash-devtool build instead of downloading one |

Running it again reuses the same wallet and address. It only asks the faucet for coins when the balance is zero.

**Prebuilt for:** macOS (Apple Silicon + Intel), Linux (x64 + arm64), Windows x64.

## 👀 Payment watcher

Give it a viewing key and the memo you expect. It prints one JSON line when the payment is **mined**, and one more when it is **confirmed**. Each transaction fires once per stage, even across restarts.

```bash
npx zcash-testnet-wallet watch --ufvk uviewtest1… --memo order-42 --confirmations 3
{"stage":"mined","txid":"9f2c…","zat":10000000,"taz":0.1,"memos":["order-42"],"height":4560012,"confirmations":1}
{"stage":"confirmed","txid":"9f2c…","zat":10000000,"taz":0.1,"memos":["order-42"],"height":4560012,"confirmations":3}
```

From code:

```js
import { watchPayments } from "zcash-testnet-wallet/watch";

await watchPayments({
  ufvk: process.env.UFVK,          // view-only: it can see payments, never spend
  memo: "order-42",                // omit to see every incoming payment
  confirmations: 3,
  onPayment: (e) => e.stage === "confirmed" && markPaid(e.txid),
});
```

It keeps a view-only zcash-devtool wallet, syncs it every 30 seconds and reads the wallet's own database. Payments are reported from the block they're mined in; a mempool ("seen") stage is on the roadmap.

## 🧠 How it works

```
npx zcash-testnet-wallet
   │
   ├─ 1. download zcash-devtool for your OS/CPU from this repo's GitHub release
   │     (sha256 checked against checksums.json shipped inside the npm package)
   ├─ 2. zcash-devtool wallet init -n test      → seed encrypted to a local age identity
   ├─ 3. zcash-devtool wallet list-addresses    → utest1 address + QR
   ├─ 4. npx zcash-faucet <address>             → 0.1 TAZ
   └─ 5. zcash-devtool wallet sync / balance    → wait for the next block, show the balance
```

The binaries are built by [a GitHub Actions matrix](.github/workflows/release.yml) from a pinned zcash-devtool commit with `--features qr`. Nothing is modified: you can rebuild them yourself and compare hashes.

## 🔒 Safety

- Your keys never leave your machine. The seed is stored encrypted under `~/.zcash-testnet-wallet/wallet`.
- Back up the seed: `~/.zcash-testnet-wallet/bin/*zcash-devtool* wallet -w ~/.zcash-testnet-wallet/wallet display-mnemonic --enable -i ~/.zcash-testnet-wallet/wallet/identity.txt`
- A download whose hash doesn't match is refused, never run.
- **Testnet only.** TAZ has no value. Never reuse this seed for real funds.

## 🛠 Development

```bash
npm test          # runs the CLI against a stand-in zcash-devtool, plus the watcher logic on a real SQLite file
```

Release: bump `version` in package.json, then `git tag v0.1.0 && git push --tags`. CI builds the 5 binaries, creates the GitHub release, writes checksums.json and publishes to npm (needs an `NPM_TOKEN` secret).

MIT © anukulpandey · built on [zcash-devtool](https://github.com/zcash/zcash-devtool), [zec.rocks](https://zec.rocks) and [zcash-faucet](https://github.com/anukulpandey/zcash-faucet)
