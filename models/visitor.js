const db = require('../db');
const assert = require('assert');

// glob is automatically incremented for all requests; it has a high limit (500 requests) but over a longer timespan (7 days)
// it is meant to prevent abuse where someone makes a bot to connect incessantly over longer periods of time
const category_limits = {
    faucet: 100000000,       // 1 btc
    glob: 500,
};

const category_expirations = {
    faucet: 3600000,
    glob: 86400000 * 7,     // more than 500 reqs in a week, and you're out
};

class visitorCacheModel {
    constructor() {
        this.cache = {};
    }
    fetch(timestamp, category, ip, bump) {
        if (this.cache[category] && this.cache[category][ip]) {
            const entry = this.cache[category][ip];
            if (entry.expiry > timestamp) {
                if (bump) entry.value += bump;
                return entry.value;
            }
        }
        return undefined;
    }
    update(timestamp, category, ip, value) {
        if (!this.cache[category]) this.cache[category] = {};
        if (!this.cache[category][ip]) this.cache[category][ip] = {};
        this.cache[category][ip] = {
            value,
            expiry: timestamp + 3600000,
        }
    }
}

const visitorCache = new visitorCacheModel();

const model = {
    calc_active(ip, category, bump, cb) {
        if (!cb) {
            cb = bump;
            bump = undefined;
        }
        const maxreqs = category_limits[category] || 5;
        const seen = new Date().getTime();
        const cached = visitorCache.fetch(seen, category, ip, bump);
        if (typeof cached !== 'undefined') {
            console.log(`${new Date()} [DDoS:${category}]: ${ip} == ${cached}${cached >= maxreqs ? `>=` : `<`} ${maxreqs} [cached, bump=${bump}]`);
            return cb(null, cached);
        }
        // visitorCache[category][ip].expiry = seen + 1200000; // we throw out caches every 20 minutes
        const ttl = category_expirations[category] || 86400000;
        const expiry = seen - ttl;
        db.removeAll('visitor', { seen: { $lt: expiry }}, (err) => {
            db.find('visitor', { ip, category }, (err, res) => {
                if (err) return cb("Internal error");
                let active = 0;
                for (const r of res) {
                    active += r.weight || 1;
                }
                console.log(`${new Date()} [DDoS:${category}]: ${ip} == ${active}${active >= maxreqs ? `>=` : `<`} ${maxreqs}`);
                visitorCache.update(seen, category, ip, active);
                cb(null, active);
            });
        });
    },
    check_real(ip, category, cb) {
        const maxreqs = category_limits[category] || 5;
        this.calc_active(ip, category, (err, active) => {
            if (err) return cb("internal error");
            cb(active >= maxreqs ? "Too many requests, try again later" : undefined, active);
        });
    },
    check(ip, category, cb) {
        this.check_real(ip, 'glob',
            glob_err => glob_err
                ? cb(glob_err)
                : this.check_real(ip, category, cb)
        );
    },
    visit_real(ip, category, weight, cb) {
        if (!cb) {
            cb = weight;
            weight = 1;
        }
        const maxreqs = category_limits[category] || 5;
        const seen = new Date().getTime();
        this.calc_active(ip, category, weight, (err, active) => {
            if (err) return cb("internal error");
            if (active >= maxreqs) return cb("Too many requests, try again later");
            db.insert(
                'visitor',
                { ip, category, weight, seen },
                (err, res) => cb(err, !err && res ? res.insertedId : undefined, active)
            );
        });
    },
    visit(ip, category, weight, cb) {
        this.visit_real(ip, 'glob',
            glob_err => glob_err
                ? cb(glob_err)
                : this.visit_real(ip, category, weight, cb)
        );
    },
    unvisit(id, cb) {
        db.remove('visitor', { _id: id }, cb);
    },
};

module.exports = model;
