#!/usr/bin/env node
import * as express from 'express';
import * as rlf from 'rate-limiter-flexible';
import * as session from 'express-session';
import * as ejs from 'ejs';
import * as fs from 'fs';
import * as path from 'path';
import * as svgCaptcha from 'svg-captcha';

import { client as bitcoin } from './bitcoin';

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
    points: 100000000,  // 1 btc
    duration: 3600,     // per hour
}

const rlfGlobOpts = {
    points: 500,            // 500 requests
    duration: 86400 * 7,    // per week
}

const rlfFaucet = new rlf.RateLimiterMemory(rlfFaucetOpts);
const rlfGlob = new rlf.RateLimiterMemory(rlfGlobOpts);

const check = async (req: Request, _res: Response) => {
    if (config.faucetPassword) return; // we don't support banning when password is enabled

    const ip = req.headers["x-real-ip"];
    if (!ip || `${ip}` === "undefined") {
        throw new Error('Internal error (IP)');
    }
    if (!fs.existsSync('banned.txt')) return;
    const lr = require('readline').createInterface({
        input:fs.createReadStream('banned.txt')
    });
    console.log(`${new Date()} :: ${ip}`)
    const p: Promise<void> = new Promise(resolve => {
        lr.on('line', (l: string) => {
            if (l === ip) throw new Error('Internal error');
        });
        lr.on('close', () => resolve());
    });
    await p;
}

const render = (_req: Request, res: Response, filebasename: string, data: MixedData) => {
    const filename = `html/${filebasename.includes('.') ? filebasename : `${filebasename}.html`}`;
    if (!fs.existsSync(filename)) {
        res.status(400).send({ message: 'file not found' });
        return;
    }
    if (filename.endsWith('.html')) {
        ejs.renderFile(filename, data || {}, {}, (err, html) => {
            if (err) {
                console.log(`ejs.renderFile ERROR for ${filename}: ${JSON.stringify(err)}`);
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

const connect = async (req: Request, res: Response) => {
    await check(req, res);
    if (!db.connected) await db.connect();
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

const get = async (req: Request, res: Response, subpath: string): Promise<Response | void> => {
    if (subpath.includes('..')) return res.status(400).send({ message: 'Invalid request' });
    await connect(req, res);
    const count = await visitorCount(req);
    render(req, res, subpath, {
        faucetUseCaptcha: count > 0,
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
app.get('/:filename', (req: Request, res: Response) => get(req, res, req.params.filename));

for (const subpath of ['css', 'images', 'lib']) {
    app.get(`/${subpath}/:filename`, (req: Request, res: Response) =>
        get(req, res, `${subpath}/${req.params.filename}`));
}

const makeClaim = async (params: MixedData, req: Request, res: Response): Promise<Response | void> => {
    const address = params.address as string;
    let amount: string | number = params.amount as string;
    await connect(req, res);
    if (!address) return res.status(400).send({ message: 'Missing address' });
    if (address.length < 10 || address.length > 100) return res.status(400).send({ message: 'Invalid address' });
    if (address.match(/^[a-zA-Z0-9]+$/) === null) return res.status(400).send({ message: 'Invalid address' });
    if (!amount) amount = "0.001";
    amount = btcString2Sat(amount);
    if (amount < 100000 || amount > 10000000) return res.status(400).send('Please check your amount and try again.');
    let count = await visitorCount(req);
    const requireCaptcha = count > 0;
    if (requireCaptcha) {
        if (req.session.captcha) {
            if (req.session.captcha === 'reload') return res.status(400).send("Captcha expired; please reload")
            if (params.captcha !== req.session.captcha) {
                return res.status(400).send("Captcha answer incorrect");
            }
            req.session.captcha = 'reload';
        } else {
            return res.status(400).send("Captcha required (reload page)");
        }
    }

    const amount2 = await calcPayout();
    if (amount2 < amount) amount = amount2;
    count = await visitorVisit(req, params, amount);
    bitcoin.sendToAddress(address, sat2BTC(amount), async (err, result) => {
        console.log(`send ${amount} sats = ${sat2BTC(amount as number)} BTC to ${address} ${JSON.stringify(err)} ${JSON.stringify(result)}`);
        if (err) throw new Error('Internal error');
        await claim.record(new Date().getTime(), amount as number);
        res.send(`Payment of ${sat2BTC(amount as number)} BTC sent with txid ${result!.result}`);
    });
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
