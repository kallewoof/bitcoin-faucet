#!/usr/bin/env node

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const ejs = require('ejs');

const config = require('./config');
const bitcoin = require('./bitcoin');
const db = require('./db');

const app = express();

const model = {
    visitor: require('./models/visitor'),
    claim: require('./models/claim'),
};

const render = (req, res, filebasename, data) => {
    ejs.renderFile(`${filebasename}.html`, data || {}, {}, (err, html) => {
        if (err) {
            console.log(`ejs.renderFile ERROR for ${filebasename}.html: ${JSON.stringify(err)}`);
            console.log(err);
            console.log(`data = ${JSON.stringify(data)}`);
            res.send('Internal error (rendering failure)');
            return;
        }
        res.send(html);
    });
};

const connect = (cb) => {
    if (!db.connected) {
        db.connect((err) => {
            return cb(err ? 'Internal error (connection failure)' : null);
        });
    } else cb(null);
};

const calc_payout = (cb) => {
    model.claim.calc_amount(cb);
}

const sat2BTC = (sat) => Number(sat / 100000000).toFixed(8);

app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
    secret: 'irgeuhaeo89hgerla',
    saveUninitialized: true,
    resave: true
}));

app.get('/', (req, res) => {
    connect((err) => {
        if (err) return res.send(err);
        const ipaddr = req.headers["x-real-ip"];
        model.visitor.check(ipaddr, 'faucet', (err2) => {
            if (err2) return res.send(err);
            render(req, res, 'index', { faucetName: config.faucetName });
        });
    });
});

app.post('/claim', (req, res) => {
    connect((err) => {
        if (err) return res.send(err);
        const ipaddr = req.headers["x-real-ip"];
        const { address } = req.body;
        if (address.length < 10 || address.length > 50) return res.send('Invalid address');
        if (address.match(/^[a-zA-Z0-9]+$/) === null) return res.send('Invalid address');
        calc_payout((err2, amount) => {
            if (err2) return res.send(err2);
            model.visitor.visit(ipaddr, 'faucet', (err3) => {
                if (err3) return res.send('Nuh-uh');
                bitcoin.sendToAddress(address, sat2BTC(amount), (err4, result) => {
                    console.log(`send ${amount} to ${address} ${JSON.stringify(err4)} ${JSON.stringify(result)}`);
                    if (err4) return res.send('Internal error');
                    model.claim.record(new Date().getTime(), amount, (err5) => {
                        res.send(`Payment of ${sat2BTC(amount)} BTC sent with txid ${result.result}`);
                    });
                });
            });
        });
    });
});

app.use((err, req, res, next) => {
    console.log(`ERROR: ${err}`);
    res.status(500);
    res.send('Internal error (unknown error)');
});

app.listen(8123, () => console.log('Faucet running on port 8123'));
