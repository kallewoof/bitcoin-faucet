const db = require('../db');
const assert = require('assert');

const category_limits = {
    faucet: 1,
};

const model = {
    check(ip, category, cb) {
        const maxreqs = category_limits[category] || 5;
        const seen = new Date().getTime();
        const expiry = seen - 86400000;
        db.remove('visitor', { seen: { $lt: expiry }}, (err) => {
            db.find('visitor', { ip, category }, (err, res) => {
                console.log(`[DDoS:${category}]: ${ip} => ${res.length}`);
                if (err) return cb("Internal error");
                if (res.length > maxreqs) return cb("Too many requests, try again later");
                cb();
            });
        });
    },
    visit(ip, category, cb) {
        const maxreqs = category_limits[category] || 5;
        const seen = new Date().getTime();
        const expiry = seen - 86400000;
        db.remove('visitor', { seen: { $lt: expiry }}, (err) => {
            db.find('visitor', { ip, category }, (err, res) => {
                console.log(`[DDoS:${category}]: ${ip} => ${res.length}`);
                if (err) return cb("internal error");
                if (res.length > maxreqs) return cb("Too many requests, try again later");
                db.insert(
                    'visitor',
                    { ip, category, seen },
                    cb
                );
            });
        });
    },
};

module.exports = model;
