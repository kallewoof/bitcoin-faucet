#!/usr/bin/env node

import config from './config';

const bcrpc = require('bcrpc'); // no ts

if (config.bitcoind.port === 8332) throw new Error("you are insane");

export interface BitcoinRPCResult {
    result: string | number | (string | number)[] | { [type: string]: {} };
}

export interface BitcoinRPCClient {
    getBalance: (cb: (err?: string, result?: number) => void) => void;
    sendToAddress: (address: string, amount: number | string,
        cb: (err?: string, result?: BitcoinRPCResult) => void) => void;
}

export const client: BitcoinRPCClient = new bcrpc({...config.bitcoind, prot: 'http' });
