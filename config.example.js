const BTC = 100000000;
const mBTC = 100000;

const config = {
    bitcoind: {
        host: process.env.BITCOIND_HOST || 'localhost',
        port: process.env.BITCOIND_PORT || 38332,
        cookie: process.env.BITCOIND_COOKIE,
    },
    // faucet name (e.g. "Bitcoin Faucet") -- here it is set to Signet Faucet, and above rpcport is
    // the default signet port
    faucetName: "Signet Faucet",
    // several maximums in place to prevent someone from claiming too much too quickly
    faucetHourMax: 100 * BTC,
    faucetDayMax: 1000 * BTC,
    faucetWeekMax: 2000 * BTC,
    // we will not pay out less than the minimum, and will tell users to wait awhile
    faucetMin: 100 * mBTC,
    // we expect 10 people to claim coins from the faucet each hour, so we will by default
    // send (hour remaining coins)/10 coins, with a lower cap of faucetMin
    faucetHourSplit: 10,
};

module.exports = config;
