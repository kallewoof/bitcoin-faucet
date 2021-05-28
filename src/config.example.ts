const BTC = 100000000;
const mBTC = 100000;

const config = {
    bitcoind: {
        host: process.env.BITCOIND_HOST || 'localhost',
        port: process.env.BITCOIND_RPCPORT || 38332,
        user: process.env.BITCOIND_USER,
        pass: process.env.BITCOIND_PASS,
        cookie: process.env.BITCOIND_COOKIE,
    },
    mongoHost: process.env.MONGODB_HOST || 'localhost',
    // faucet name (e.g. "Bitcoin Faucet") -- here it is set to Signet Faucet, and above rpcport is
    // the default signet port
    faucetName: process.env.FAUCET_NAME || "Signet Faucet",
    // two options: rate limiting via IP address, OR rate limiting by requiring a pass phrase
    // if faucetPassword is unset, IP rate limiting is enforced, otherwise it is not
    faucetPassword: process.env.FAUCET_PASSWORD,
    // several maximums in place to prevent someone from claiming too much too quickly
    faucetHourMax: Number.parseInt(process.env.FAUCET_HOUR_MAX || "100", 10) * BTC,
    faucetDayMax: Number.parseInt(process.env.FAUCET_DAY_MAX || "1000", 10) * BTC,
    faucetWeekMax: Number.parseInt(process.env.FAUCET_WEEK_MAX || "2000", 10) * BTC,
    // we will not pay out less than the minimum, and will tell users to wait awhile
    faucetMin: Number.parseInt(process.env.FAUCET_MIN || "100", 10) * mBTC,
    // we expect 10 people to claim coins from the faucet each hour, so we will by default
    // send (hour remaining coins)/10 coins, with a lower cap of faucetMin
    faucetHourSplit: process.env.FAUCET_HOUR_SPLIT || 10,
    explorerUrl: process.env.EXPLORER_URL || "https://explorer.bc-2.jp/tx/",
    sessionSecret: 'placesecrethere',
};

export default config;
