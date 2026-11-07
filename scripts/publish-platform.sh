#!/bin/sh
# Publish one prebuilt zcash-devtool as an npm platform package, from your own machine.
#   sh scripts/publish-platform.sh <path/to/zcash-devtool> <os> <cpu> [--dry-run]
#   e.g. sh scripts/publish-platform.sh target/release/zcash-devtool darwin arm64
# <os>/<cpu> use Node's names (process.platform / process.arch): darwin, linux, win32 / arm64, x64.
set -eu
bin=$1 os=$2 cpu=$3; shift 3
root=$(cd "$(dirname "$0")/.." && pwd)
version=$(node -p "require('$root/package.json').version")
name="zcash-testnet-wallet-$os-$cpu"
exe=zcash-devtool; [ "$os" = win32 ] && exe=zcash-devtool.exe
dir=$(mktemp -d)/$name
mkdir -p "$dir/bin"
cp "$bin" "$dir/bin/$exe" && chmod 755 "$dir/bin/$exe"
[ "$os" = win32 ] || strip "$dir/bin/$exe" 2>/dev/null || true
cat > "$dir/package.json" <<JSON
{
  "name": "$name",
  "version": "$version",
  "description": "Prebuilt zcash-devtool ($os-$cpu, --features qr) for zcash-testnet-wallet",
  "os": ["$os"],
  "cpu": ["$cpu"],
  "files": ["bin"],
  "repository": { "type": "git", "url": "git+https://github.com/anukulpandey/zcash-testnet-wallet.git" },
  "license": "MIT"
}
JSON
echo "zcash-devtool built from https://github.com/zcash/zcash-devtool (MIT/Apache-2.0), see the zcash-testnet-wallet README." > "$dir/README.md"
cd "$dir" && npm publish --access public "$@"
