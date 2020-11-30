#!/usr/bin/env node

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const ejs = require('ejs');
const fs = require('fs');
const path = require('path');
const svgCaptcha = require('svg-captcha');

const config = require('./config');
const bitcoin = require('./bitcoin');
const db = require('./db');

const app = express();

const model = {
    visitor: require('./models/visitor'),
    claim: require('./models/claim'),
};

const check = (req, res, cb) => {
    const fs = require('fs');
    if (config.faucetPassword) return cb(null); // we don't support banning when password is enabled

    const ip = req.headers["x-real-ip"];
    if (!ip || `{ip}` === "undefined") {
        return cb('Internal error (IP)');
    }
    if (!fs.existsSync('banned.txt')) return cb(null);
    const lr = require('readline').createInterface({
        input:fs.createReadStream('banned.txt')
    });
    let ok = true;
    console.log(`${new Date()} :: ${ip}`)
    lr.on('line', (l) => {
        if (l === ip) {
            ok = false;
            return cb('Internal error');
        }
    });
    lr.on('close', () => !ok || cb(null));
};

const render = (_req, res, filebasename, data) => {
    const filename = `html/${filebasename.includes('.') ? filebasename : `${filebasename}.html`}`;
    if (!fs.existsSync(filename)) return res.status(400).send({ message: 'file not found' });
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

const connect = (req, res, cb) => {
    check(req, res, (err) => {
        if (err) return cb(err);
        if (!db.connected) {
            db.connect((err) => {
                return cb(err ? 'Internal error (connection failure)' : null);
            });
        } else cb(null);
    });
};

const calc_payout = (cb) => {
    model.claim.calc_amount(cb);
}

let visitorCheck;
let visitorVisit;
let visitorUnvisit;
if (config.faucetPassword) {
    visitorCheck = (_req, params, _category, _weight, cb) => {
        const { password } = params;
        cb(password === config.faucetPassword ? null : "invalid password", 0);
    }
    visitorVisit = (_req, params, _category, _weight, cb) => {
        const { password } = params;
        cb(password === config.faucetPassword ? null : "invalid password");
    };
    visitorUnvisit = (_id, cb) => cb();
} else {
    visitorCheck = (req, _params, category, cb) => model.visitor.check(req.headers["x-real-ip"], category, cb);
    visitorVisit = (req, _params, category, weight, cb) => model.visitor.visit(req.headers["x-real-ip"], category, weight, cb);
    visitorUnvisit = (id, cb) => model.visitor.unvisit(id, cb);
}

const COIN = 100000000;
const sat2BTC = (sat) => Number(sat / COIN).toFixed(8);
const btcString2Sat = (btcString) => {
    const comps = btcString.split('.');
    let sats = Number.parseInt(comps[0]) * COIN;
    if (comps.length === 2) {
        const rem = `${comps[1]}00000000`.substr(0, 8);
        sats += Number.parseInt(rem);
    }
    return sats;
};

app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
    secret: 'irgeuhaeo89hgerla',
    saveUninitialized: true,
    resave: true
}));

const get = (req, res, subpath) => {
    if (subpath.includes('..')) return res.status(400).send({ message: 'Invalid request' });
    connect(req, res, err => {
        if (err) return res.status(400).send({ message: err });
        visitorCheck(req, req.params, 'faucet', (err, count) => {
            if (err) return res.status(400).send({ message: 'Internal failure' });
            render(req, res, subpath, {
                faucetUseCaptcha: count > 0,
                faucetName: config.faucetName,
                faucetUsePass: config.faucetPassword ? true : false,
                explorerUrl: config.explorerUrl
            });
        });
    });
}

// captcha
app.get('/captcha', (req, res) => {
    let captcha = svgCaptcha.create();
    req.session.captcha = captcha.text;
    res.type('svg');
    res.status(200).send(captcha.data);
});
// /captcha

app.get('/', (req, res) => get(req, res, 'index'));
app.get('/:filename', (req, res) => get(req, res, req.params.filename));
for (const subpath of ['css', 'images', 'lib']) {
    app.get(`/${subpath}/:filename`, (req, res) => get(req, res, `${subpath}/${req.params.filename}`));
}

let claim = (params, req, res) => {
    let { address, amount } = params;
    connect(req, res, (err) => {
        if (err) return res.status(400).send({ message: err });
        visitorCheck(req, params, 'faucet', (err, count) => {
            if (err) return res.status(400).send({ message: err });
            const requireCaptcha = count > 0;
            if (req.session.captcha) {
                if (req.session.captcha === 'reload') return res.status(400).send("Captcha expired; please reload")
                if (params.captcha !== req.session.captcha) {
                    return res.status(400).send("Captcha answer incorrect");
                }
                req.session.captcha = 'reload';
            } else if (requireCaptcha) {
                return res.status(400).send("Captcha required (reload page)");
            }

            const ipaddr = req.headers["x-real-ip"];
            if (address.length < 10 || address.length > 50) return res.status(400).send({ message: 'Invalid address' });
            if (address.match(/^[a-zA-Z0-9]+$/) === null) return res.status(400).send({ message: 'Invalid address' });
            if (!address) return res.status(400).send({ message: 'Missing address' });
            if (!amount) amount = "0.001";
            // btc -> sat
            amount = btcString2Sat(amount);
            if (amount < 100000 || amount > 1000000) return res.status(400).send('Please check your amount and try again.');
            calc_payout((err2, amount2) => {
                if (err2) return res.status(400).send({ message: err2 });
                if (amount2 < amount) amount = amount2;
                visitorVisit(req, params, 'faucet', amount, (err3, iid, count) => {
                    if (err3) return res.status(400).send('You have reached your capacity. Try lowering the amount.');
                    // if (count > 0 && )
                    bitcoin.sendToAddress(address, sat2BTC(amount), (err4, result) => {
                        console.log(`send ${amount} sats = ${sat2BTC(amount)} BTC to ${address} ${JSON.stringify(err4)} ${JSON.stringify(result)}`);
                        if (err4) {
                            return visitorUnvisit(iid, () => res.status(400).send({ message: 'Internal error' }));
                        }
                        model.claim.record(new Date().getTime(), amount, (err5) => {
                            res.send(`Payment of ${sat2BTC(amount)} BTC sent with txid ${result.result}`);
                        });
                    });
                });
            });
        });
    });
};

app.post('/claim', (req, res) => claim(req.body, req, res));

if (config.faucetPassword) {
    app.get('/claim/:address/:amount/:password', (req, res) => claim(req.params, req, res));
} else {
    app.get('/claim/:address/:amount', (req, res) => claim(req.params, req, res));
    app.get('/claim/:address/:amount/:captcha', (req, res) => claim(req.params, req, res));
}

app.use((err, req, res, next) => {
    console.log(`ERROR: ${err}`);
    res.status(500);
    res.status(400).send('Internal error (unknown error)');
});

app.listen(8123, () => console.log('Faucet running on port 8123'));
