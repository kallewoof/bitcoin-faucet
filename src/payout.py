#!/usr/bin/env python3

# Read from payouts.txt [address] [amount] [ip].
# If the same IP is found more than once, silently discard the entries.

import decimal
import json
import os
import subprocess
import sys
import time

HOME=os.environ['HOME']
#CMD=f"{HOME}/workspace/bitcoin/src/bitcoin-cli -datadir={HOME}/signet -rpcwallet=faucet"
CMD=f"bitcoin-cli -rpcwallet="

MAX_PER_TX=500
BTC_PER_TX=decimal.Decimal("1.0")
BTC_PER_OUT=decimal.Decimal("0.1")
QUANTIZE=decimal.Decimal(10)**-5

class Entry:
    def __init__(self, address, amount, ip):
        self.address = address
        self.amount = amount
        self.ip = ip

    def __str__(self):
        return f"{self.address} {self.amount} {self.ip}"

    def __repr__(self):
        return f"{self.address} {self.amount} {self.ip}"

def main():
    ips = set()
    addresses = set()

    while True:
        # Process existing file, if any
        if os.path.exists("payouts-processing.txt"):
            done = False
            while not done:
                # Sleep for 5 seconds
                print(f"{time.ctime()}: Sleeping for 30 seconds")
                time.sleep(30)

                # Read next entry
                requests = []
                with open("payouts-processing.txt", "r") as f:
                    dupe_addr = set()
                    dupe_ip = set()
                    for line in f:
                        address, amount, ip = line.strip().split(" ")
                        if ip in ips: continue
                        if ip in dupe_ip: continue
                        if address in addresses: continue
                        if address in dupe_addr: continue
                        dupe_addr.add(address)
                        dupe_ip.add(ip)
                        res = subprocess.run(f"{CMD} getaddressinfo {address}", capture_output=True, shell=True, encoding='utf8')
                        if res.returncode != 0 or "scriptPubKey" not in json.loads(res.stdout): continue
                        requests.append(Entry(address, amount, ip))
                if not requests:
                    done = True
                else:
                    entries, requests = requests[:MAX_PER_TX], requests[MAX_PER_TX:]
                    amount = min(BTC_PER_OUT, (BTC_PER_TX/len(entries)).quantize(QUANTIZE, rounding=decimal.ROUND_DOWN))
                    proc = subprocess.Popen(f"{CMD} -stdin createrawtransaction", stdin=subprocess.PIPE, stdout=subprocess.PIPE, shell=True, encoding='utf8')
                    proc.stdin.write("[]\n") # inputs
                    proc.stdin.write("[") # outputs
                    comma = ""
                    for entry in entries:
                        if entry.address in addresses: continue
                        print(f"{time.ctime()}: {entry} ({amount})")
                        ips.add(entry.ip)
                        addresses.add(entry.address)
                        modamount = amount if amount <= decimal.Decimal(entry.amount) else entry.amount
                        proc.stdin.write('%s {"%s": %s}' % (comma, entry.address, modamount))
                        comma = ","
                    proc.stdin.write("]\n")
                    proc.stdin.close()
                    unfunded = proc.stdout.read()

                    proc = subprocess.Popen(f"{CMD} -stdin fundrawtransaction", stdin=subprocess.PIPE, stdout=subprocess.PIPE, shell=True, encoding='utf8')
                    out, errs = proc.communicate(unfunded)
                    funded = json.loads(out)["hex"]

                    proc = subprocess.Popen(f"{CMD} -stdin signrawtransactionwithwallet", stdin=subprocess.PIPE, stdout=subprocess.PIPE, shell=True, encoding='utf8')
                    out, errs = proc.communicate(funded)
                    signed = json.loads(out)["hex"]

                    subprocess.run(f"{CMD} -stdin sendrawtransaction", input=signed, shell=True, encoding='utf8')

                    # Read remainder into payouts w
                    with open("payouts-processing.tmp", "w") as w:
                        for e in requests:
                            w.write(str(e) + "\n")
                    # Replace processing file
                    os.system("mv payouts-processing.tmp payouts-processing.txt")
        # Wait for the file to appear
        while not os.path.exists("payouts.txt"):
            time.sleep(5)
        # Move the file for processing
        os.system("mv payouts.txt payouts-processing.txt")

if __name__ == "__main__":
    main()
