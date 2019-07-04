const db = require('../db');

const model = {
    cache: {},
    set(key, value, cb) {
        this.cache[key] = value;
        db.upsert(
            'rcstate',
            { key },
            { key, value },
            cb
        );
    },
    get(key, fallback, cb) {
        if (!cb) {
            cb = fallback;
            fallback = null;
        }
        if (typeof(this.cache[key]) !== 'undefined') {
            return cb(this.cache[key]);
        }
        db.find('rcstate', { key }, (err, results) => {
            const value = results.length ? results[0].value : null;
            if (!err) this.cache[key] = value;
            cb(value || fallback);
        });
    },
};

module.exports = model;
