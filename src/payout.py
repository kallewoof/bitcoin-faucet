# Read from payouts.txt [address] [amount] [ip].
# If the same IP is found more than once, silently discard the entries.

import os
import time

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
    while True:
        # Process existing file, if any
        if os.path.exists("payouts-processing.txt"):
            done = False
            while not done:
                # Sleep for 5 seconds
                print(f"{time.ctime()}: Sleeping for 5 seconds")
                time.sleep(5)
                # Read next entry
                with open("payouts-processing.txt", "r") as f:
                    line = f.readline()
                    print(f"entry: {line}")
                    if line == "":
                        done = True
                        break
                    address, amount, ip = line.strip().split(" ")
                    if ip not in ips:
                        ips.add(ip)
                        entry = Entry(address, amount, ip)
                        print(entry)
                        os.system(f"./signet-make-payout-to.sh {entry.address} {entry.amount}")
                    # Read remainder into payouts w
                    with open("payouts-processing.tmp", "w") as w:
                        w.write(f.read())
                # Replace processing file
                os.system("mv payouts-processing.tmp payouts-processing.txt")
        # Wait for the file to appear
        while not os.path.exists("payouts.txt"):
            time.sleep(30)
        # Move the file for processing
        os.system("mv payouts.txt payouts-processing.txt")

if __name__ == "__main__":
    main()
