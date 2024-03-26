#!/bin/bash
~/workspace/bitcoin/src/bitcoin-cli -datadir=$HOME/signet -rpcwallet=faucet sendtoaddress $1 $2
