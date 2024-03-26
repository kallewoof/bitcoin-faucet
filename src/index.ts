#!/usr/bin/env node
import * as express from 'express';
import * as rlf from 'rate-limiter-flexible';
import * as session from 'express-session';
import * as ejs from 'ejs';
import * as fs from 'fs';
import * as path from 'path';
import * as svgCaptcha from 'svg-captcha';

//import { client as bitcoin } from './bitcoin';

import { db, MixedData } from './db';

import claim from './models/claim';

import { Request, Response } from 'express';

declare module 'express-session' {
    export interface SessionData {
        captcha: string;
    }
}

import config from './config';

const app = express();

const rlfFaucetOpts = {
    points: 10000000,  // 0.1 btc
    duration: 86400,   // per day
}

const rlfGlobOpts = {
    points: 10,            // 10 requests
    duration: 86400 * 7,    // per week
}

const rlfFaucet = new rlf.RateLimiterMemory(rlfFaucetOpts);
const rlfGlob = new rlf.RateLimiterMemory(rlfGlobOpts);

let lastLog: [string, number] = ["", 0];
const log = (prefix?: string, s?: string) => {
    if (!s) {
        s = prefix!;
        prefix = undefined;
    }
    if (lastLog[0] === s) {
        lastLog[1]++;
        return;
    }
    if (lastLog[1] > 1) {
        console.log(` (repeated ${lastLog[1]} times)`);
    }
    lastLog = [s, 1];
    console.log((prefix || "") + s);
}

const check = async (req: Request, _res: Response) => {
    if (config.faucetPassword) return; // we don't support banning when password is enabled
    if (!fs.existsSync('banned.txt')) return;

    const iph = req.headers["x-real-ip"];
    if (!iph || `${iph}` === "undefined") {
        return false;
    }
    const ip: string = Array.isArray(iph) ? iph[0]! : iph;
    const lr = require('readline').createInterface({
        input:fs.createReadStream('banned.txt')
    });
    let banned = false;
    const p: Promise<void> = new Promise(resolve => {
        lr.on('line', (l: string) => {
            if (ip.indexOf(l) === 0) {
                banned = true;
                lr.close();
            }
        });
        lr.on('close', () => resolve());
    });
    await p;
    log(`${new Date()}`, ` :: ${ip}${banned ? " (banned)" : ""}`)
    return !banned;
}

const render = (_req: Request, res: Response, filebasename: string, data: MixedData) => {
    const filename = `../html/${filebasename.includes('.') ? filebasename : `${filebasename}.html`}`;
    if (!fs.existsSync(filename)) {
        res.status(400).send({ message: 'file not found' });
        return;
    }
    if (filename.endsWith('.html')) {
        ejs.renderFile(filename, data || {}, {}, (err, html) => {
            if (err) {
                log(`ejs.renderFile ERROR for ${filename}: ${JSON.stringify(err)}`);
                console.log(err);
                console.log(`data = ${JSON.stringify(data)}`);
                res.status(400).send('Internal error (rendering failure)');
                return;
            }
            res.send(html);
        });
        return;
    }
    // pass file on
    res.sendFile(path.join(`${__dirname}/${filename}`));
};

const addrCap: number = 128;
let addrList: string[] = [];
let addrCount: number[] = [];
let day: number = 0;

/**
 * Add address to list, returning whether it was new (true) or not (false)
 *
 * @param addr The bitcoin address
 * @returns true if the address was new, false if it already existed in the list
 */
const addAddr = (addr: string) => {
    const today = new Date().getDate();
    if (today !== day) {
        addrList = [];
        addrCount = [];
        day = today;
    }
    const existing = addrList.indexOf(addr);
    let count = 1;
    if (existing !== -1) {
        count = 1 + addrCount[existing];
        addrList.splice(existing, 1);
        addrCount.splice(existing, 1);
    }
    addrList.push(addr);
    addrCount.push(count);
    if (addrList.length > addrCap) {
        addrList.shift();
        addrCount.shift();
    }
    return existing === -1;
}

const validateClaim = (addr: string, req: Request, res: Response) => {
    if (addAddr(addr)) {
        // new; go on
        return true;
    }
    log(`worthless render for: ${addr}`);
    render(req, res, 'worthless', {
        faucetName: config.faucetName
    });
    return false;
}

const connect = async (req: Request, res: Response) => {
    if (!(await check(req, res))) return false;
    if (!db.connected) await db.connect();
    return true;
};

const calcPayout = async () => claim.calc_amount();

let visitorCount: (req: Request) => Promise<number>;
let visitorVisit: (req: Request, params: MixedData, weight?: number) => Promise<number>;
if (config.faucetPassword) {
    visitorCount = async (_req: Request) => 0;
    visitorVisit = async (_req: Request, params: MixedData, _weight?: number) => {
        const { password } = params;
        if (password !== config.faucetPassword) throw new Error("invalid password");
        return 0;
    };
} else {
    visitorCount = async (req: Request) => {
        const rl: rlf.RateLimiterRes | null = await rlfFaucet.get(req.headers["x-real-ip"] as string);
        return rl ? rl.consumedPoints : 0;
    }
    visitorVisit = async (req: Request, _params: MixedData, weight?: number) => {
        const addr = req.headers["x-real-ip"] as string;
        await rlfGlob.consume(addr, 1);
        const rl = await rlfFaucet.consume(addr, weight);
        return rl.consumedPoints;
    }
}

const COIN = 100000000;
const sat2BTC = (sat: number) => Number(sat / COIN).toFixed(8);
const btcString2Sat = (btcString: string) => {
    const comps = btcString.split('.');
    let sats = Number.parseInt(comps[0], 10) * COIN;
    if (comps.length === 2) {
        const rem = `${comps[1]}00000000`.substr(0, 8);
        sats += Number.parseInt(rem, 10);
    }
    return sats;
};

app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: config.sessionSecret,
    saveUninitialized: true,
    resave: true
}));

const get = async (req: Request, res: Response, subpath: string, ignoreban = false): Promise<Response | void> => {
    if (subpath.includes('..')) return res.status(400).send({ message: 'Invalid request' });
    if (!(await connect(req, res))) {
        // user is banned
	if (!ignoreban) {
            return res.status(500).send('Maintenance mode - please try again later');
	}
    }
    // const count = await visitorCount(req);
    render(req, res, subpath, {
        faucetUseCaptcha: true,//count > 0,
        faucetName: config.faucetName,
        faucetUsePass: config.faucetPassword ? true : false,
        explorerUrl: config.explorerUrl
    });
}

// captcha
app.get('/captcha', (req: Request, res: Response) => {
    const captcha = svgCaptcha.create();
    req.session!.captcha = captcha.text;
    res.type('svg');
    res.status(200).send(captcha.data);
});
// /captcha

app.get('/', (req: Request, res: Response) => get(req, res, 'index'));
app.get('/:filename', (req: Request, res: Response) => get(req, res, req.params.filename, req.params.filename === 'worthless'));

for (const subpath of ['css', 'images', 'lib']) {
    app.get(`/${subpath}/:filename`, (req: Request, res: Response) =>
        get(req, res, `${subpath}/${req.params.filename}`));
}

let claims = 0;
let requests = 0;
//let ignores = 0;

function countFileLines(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
	let lineCount = 0;
	fs.createReadStream(filePath)
	    .on("data", (buffer) => {
		let idx = -1;
		lineCount--; // Because the loop will run once for idx=-1
		do {
		    idx = buffer.indexOf('\n', idx+1);
		    lineCount++;
		} while (idx !== -1);
	    }).on("end", () => {
		resolve(lineCount);
	    }).on("error", reject);
    });
};


const makeClaim = async (params: MixedData, req: Request, res: Response): Promise<Response | void> => {
    const address = params.address as string;
    let amount: string | number = params.amount as string;
    requests++;
    log(`request ${requests}: address ${address}, amount ${amount}, ip ${req.headers["x-real-ip"]}`);
    if (!(await connect(req, res))) {
        // user is banned
        return res.status(500).send('Maintenance mode - please try again later');
    }
    console.log('connected');
    if (!address) return res.status(400).send({ message: 'Missing address' });
    if (address.length < 10 || address.length > 100) return res.status(400).send({ message: 'Invalid address' });
    if (address.match(/^[a-zA-Z0-9]+$/) === null) return res.status(400).send({ message: 'Invalid address' });
    if (!amount) amount = "0.001";
    amount = btcString2Sat(amount);
    if (amount < 10000 || amount > 1000000) return res.status(400).send('Please check your amount and try again.');
    let count = await visitorCount(req);
    console.log(`fetched visitor count ${count}`);
    const requireCaptcha = true; //count > 0;
    if (requireCaptcha) {
        if (req.session.captcha) {
            if (req.session.captcha === 'reload') return res.status(400).send("Captcha expired; please reload")
            if (params.captcha !== req.session.captcha) {
                return res.status(400).send("Captcha answer incorrect");
            }
            req.session.captcha = 'reload';
        } else {
            return res.status(429).send("Captcha required (reload page)");
        }
    }

    const amount2 = await calcPayout();
    console.log(`calculated pay-out ${amount2}`);
    if (amount2 < amount) amount = amount2;
    try {
        count = await visitorVisit(req, params, amount);
    } catch (e) {
        return res.status(429).send({ message: 'Please slow down' });
    }
    console.log(`visitor-visited with ${count}`);
    if (validateClaim(address, req, res)) {
	let count = 0;
	try {
	    count = Number.parseInt(fs.readFileSync('counter.txt', 'utf8'), 10);
	    count += await countFileLines('payouts.txt');
	} catch (e) {}
	count *= 30;
	let count_expr = `${count.toFixed(2)} seconds`;
	if (count > 3600) {
	    count /= 3600;
	    count_expr = `${count.toFixed(2)} hour(s)`;
	} else if (count > 60) {
	    count /= 60;
	    count_expr = `${count.toFixed(2)} minute(s)`;
	}
	fs.appendFileSync('payouts.txt', `${address} ${sat2BTC(amount)} ${req.headers["x-real-ip"]}\n`);
	claims++;
        console.log(`claim ${claims}: send ${amount} sats = ${sat2BTC(amount as number)} BTC to ${address}`);
	await claim.record(new Date().getTime(), amount as number);
	res.send(`A pay-out to your address has been queued and will be made in approximately ${count_expr}. If it is detected that you are attempting to circumvent the checks in place in order to get more than one payment, your existing queued payments will be silently discarded. Please sit tight and wait for the payment to occur. This may take a long time depending on how many people are accessing the web site.`);
            /*bitcoin.sendToAddress(address, sat2BTC(amount), async (err, result) => {
		if (!err) {
                    claims++;
                    await claim.record(new Date().getTime(), amount as number);
                    res.send(`Payment of ${sat2BTC(amount as number)} BTC sent with txid ${result!.result}`);
		}
            });*/
    }
};

app.post('/claim', (req: Request, res: Response) => makeClaim(req.body, req, res));

if (config.faucetPassword) {
    app.get('/claim/:address/:amount/:password', (req: Request, res: Response) => makeClaim(req.params, req, res));
} else {
    app.get('/claim/:address/:amount', (req: Request, res: Response) => makeClaim(req.params, req, res));
    app.get('/claim/:address/:amount/:captcha', (req: Request, res: Response) => makeClaim(req.params, req, res));
}

app.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
    console.log(`ERROR: ${err}`);
    res.status(500);
    res.status(400).send('Internal error (unknown error)');
});

app.listen(8123, () => console.log('Faucet running on port 8123'));
