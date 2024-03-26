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

FILE_IN = "payouts.txt"
FILE_WORK = "payouts-processing.txt"
FILE_NEXT = "payouts-processing.tmp"

class Entry:
    def __init__(self, address, amount, ip):
        self.address = address
        self.amount = amount
        self.ip = ip

    def __str__(self):
        return f"{self.address} {self.amount} {self.ip}"

    def __repr__(self):
        return f"{self.address} {self.amount} {self.ip}"

def filesize(path):
    try:
        return os.stat(path).st_size
    except:
        return 0

def main():
    ips = set()
    addresses = set()

    while True:
        # Process existing file, if any
        if os.path.exists(FILE_WORK):
            done = False
            while not done:
                # Sleep for 5 seconds
                print(f"{time.ctime()}: Sleeping for 30 seconds (IN: {filesize(FILE_IN)}, WORK: {filesize(FILE_WORK)})")
                time.sleep(30)

                # Read next entry
                requests = []
                with open(FILE_WORK, "r") as f, open(FILE_NEXT, "w") as w:
                    dupe_addr = set()
                    dupe_ip = set()
                    w.write("")
                    for line in f:
                        if len(requests) >= MAX_PER_TX:
                            # save these for later
                            w.write(line)
                            continue
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
                    amount = min(BTC_PER_OUT, (BTC_PER_TX/len(requests)).quantize(QUANTIZE, rounding=decimal.ROUND_DOWN))
                    proc = subprocess.Popen(f"{CMD} -stdin createrawtransaction", stdin=subprocess.PIPE, stdout=subprocess.PIPE, shell=True, encoding='utf8')
                    proc.stdin.write("[]\n") # inputs
                    proc.stdin.write("[") # outputs
                    comma = ""
                    for entry in requests:
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

                # Replace processing file
                os.rename(FILE_NEXT, FILE_WORK)
        # Wait for the file to appear
        while not os.path.exists(FILE_IN):
            time.sleep(5)
        # Move the file for processing
        os.rename(FILE_IN, FILE_WORK)

if __name__ == "__main__":
    main()
