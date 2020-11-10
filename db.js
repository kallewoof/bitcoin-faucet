const { MongoClient, ObjectID } = require('mongodb');
const assert = require('assert');
const config = require('./config');

const url = `mongodb://${config.mongoHost}:27017`;
const dbname = 'bitcoin-faucet';

module.exports = {
    id(id) {
        return new ObjectID(id);
    },
    connect(cb) {
        assert(!this.connected);
        MongoClient.connect(url, { useUnifiedTopology: true, useNewUrlParser: true }, (err, client) => {
            assert(err === null);
            this.connected = true;
            this.db = client.db(dbname);
            cb(err);
        });
    },
    disconnect() {
        assert(this.connected);
        this.db.close();
        this.connected = false;
        this.db = null;
    },
    insert(coll, obj, cb) {
        return this.db.collection(coll).insertOne(obj, cb);
    },
    find(coll, query, sort, cb) {
        if (!cb) {
            cb = sort;
            sort = null;
        }
        const cursor = this.db.collection(coll).find(query);
        if (sort) cursor.sort(sort);
        cursor.toArray(cb);
    },
    update(coll, query, set, cb = null) {
        this.db.collection(coll).update(
            query,
            {
                $set: set,
                $currentDate: { "lastModified": true },
            },
            cb
        );
    },
    upsert(coll, query, set, cb = null) {
        this.db.collection(coll).update(
            query,
            {
                $set: set,
                $currentDate: { "lastModified": true },
            },
            {
                upsert: true,
            },
            cb
        );
    },
    remove(coll, query, cb = null) {
        this.db.collection(coll).deleteOne(query, (err, results) => {
            if (cb) cb(err, results);
            else assert(!err);
        });
    },
    removeAll(coll, query, cb = null) {
        this.db.collection(coll).deleteMany(query, (err, results) => {
            if (cb) cb(err, results);
            else assert(!err);
        });
    }
};
