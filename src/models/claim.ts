import { db } from '../db';

import config from '../config';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

class Model {
    async record(timestamp: number, amount: number) {
        return await db.insert('claim', { timestamp, amount });
    }
    async calc_amount() {
        const max = await this.calc_max();
        let amount = max / config.faucetHourSplit;
        if (amount < config.faucetMin) amount = config.faucetMin;
        if (amount > max) {
            // this should never occur due to pre-existing checks in calc_limit()
            throw new Error('Internal error');
        }
        return amount;
    }
    async calc_max() {
        const timestamp = new Date().getTime();
        // we start by checking hour, then day, then week
        let cap = await this.calc_limit(timestamp - HOUR, config.faucetHourMax, config.faucetHourMax);
        cap = await this.calc_limit(timestamp - DAY, cap, config.faucetDayMax);
        return await this.calc_limit(timestamp - WEEK, cap, config.faucetWeekMax);
    }
    async calc_limit(timestamp: number, current: number, maximum: number) {
        const results = await db.find('claim', { timestamp: { $gt: timestamp } });
        let sum = 0;
        for (const r of results) sum += r.amount;
        if (sum + config.faucetMin >= maximum) throw new Error('Capacity reached, try later');
        if (current > maximum - sum) current = maximum - sum;
        return  current;
    }
};

const claim = new Model();

export default claim;
