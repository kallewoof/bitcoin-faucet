#!/usr/bin/env node

const bcrpc = require('bcrpc');
const config = require('./config');

if (config.bitcoind.rpcport == 8332) throw "you are insane";

module.exports = new bcrpc({...config.bitcoind, prot: 'http' });
