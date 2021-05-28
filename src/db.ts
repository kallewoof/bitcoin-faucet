import { Db, MongoClient, ObjectID, SortOptionObject } from 'mongodb';
import * as assert from 'assert';

import config from './config';

const url = `mongodb://${config.mongoHost}:27017`;
const dbname = 'bitcoin-faucet';

export declare type Mixed = string | number | Buffer | boolean;
export declare type MixedData = {
    [key: string]: Mixed;
};
export declare type DBQuery = {
    [key: string]: Mixed | {
        $gt: number
    }
}

export class DB {
    connected: boolean = false;
    client?: MongoClient;
    db?: Db;

    id(id: string) {
        return new ObjectID(id);
    }
    async connect() {
        assert(!this.connected);
        this.client = await MongoClient.connect(url, { useUnifiedTopology: true, useNewUrlParser: true });
        this.db = this.client.db(dbname);
        this.connected = true;
    }
    disconnect() {
        assert(this.connected);
        this.client!.close();
        this.connected = false;
        this.db = undefined;
    }
    async insert(coll: string, obj: MixedData) {
        return await this.db!.collection(coll).insertOne(obj);
    }
    async find<T>(coll: string, query: DBQuery, sort?: string | ([string, number])[] | SortOptionObject<T>) {
        const cursor = this.db!.collection(coll).find(query);
        if (sort) cursor.sort(sort);
        return await cursor.toArray();
    }
    async update(coll: string, query: MixedData, set: MixedData) {
        return await this.db!.collection(coll).updateOne(
            query,
            {
                $set: set,
                $currentDate: { "lastModified": true },
            }
        );
    }
    async upsert(coll: string, query: MixedData, set: MixedData) {
        return await this.db!.collection(coll).updateOne(
            query,
            {
                $set: set,
                $currentDate: { "lastModified": true },
            },
            {
                upsert: true,
            }
        );
    }
    async remove(coll: string, query: MixedData) {
        return await this.db!.collection(coll).deleteOne(query);
    }
    async removeAll(coll: string, query: MixedData) {
        return await this.db!.collection(coll).deleteMany(query);
    }
};

export const db = new DB();
