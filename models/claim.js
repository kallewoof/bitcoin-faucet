const db = require('../db');
const config = require('../config');

const HOUR = 3600000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

const model = {
    record(timestamp, amount, cb) {
        db.insert('claim', { timestamp: new Date().getTime(), amount }, cb);
    },
    calc_amount(cb) {
        this.calc_max((err, max) => {
            if (err) return cb(err);
            let amount = max / config.faucetHourSplit;
            if (amount < config.faucetMin) amount = faucetMin;
            if (amount > max) return cb('Internal error'); // this should never occur due to pre-existing checks in calc_limit()
            cb(null, amount);
        });
    },
    calc_max(cb) {
        const timestamp = new Date().getTime();
        // we start by checking hour, then day, then week
        this.calc_limit(timestamp - HOUR, config.faucetHourMax, config.faucetHourMax, (err, cap) => {
            if (err) return cb(err);
            this.calc_limit(timestamp - DAY, cap, config.faucetDayMax, (err2, cap) => {
                if (err2) return cb(err2);
                this.calc_limit(timestamp - WEEK, cap, config.faucetWeekMax, cb);
            });
        });
    },
    calc_limit(timestamp, current, maximum, cb) {
        db.find('claim', { timestamp: { $gt: timestamp } }, (err, results) => {
            if (err) return cb('Internal error');
            let sum = 0;
            for (const r of results) sum += r.amount;
            if (sum + config.faucetMin >= maximum) return cb('Capacity reached, try later');
            if (current > maximum - sum) current = maximum - sum;
            cb(null, current);
        });
    }
};

module.exports = model;
