#!/bin/sh
# Stand-in for zcash-devtool: lets the CLI run end to end without a real wallet or network.
case "$*" in
  *" init "*) mkdir -p "$3" && touch "$3/data.sqlite" ;;
  *list-addresses*) echo "Account 1"; echo "     Default Address: utest1fakeaddress000"; echo "█▀▀▀█ QR"; echo "█▄▄▄█ QR" ;;
  *list-accounts*) echo "Account 1 (birthday height 4559600)"; echo "     UFVK: uviewtest1fakekey" ;;
  *sync*) ;;
  *"balance --json"*) echo '{"total":10000000,"ironwood_spendable":0,"orchard_spendable":0,"chain_tip_height":4560000}' ;;
esac
