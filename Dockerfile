# Based on Blockstream's esplora project

FROM debian:stretch-slim

# TODO: weed out unnecessary deps
RUN apt-get -y update \
    && apt-get -y install \
        curl

RUN curl -sL https://deb.nodesource.com/setup_10.x | bash -

RUN apt-get -y install nodejs

RUN mkdir -p /srv/faucet

COPY ./ /srv/faucet

WORKDIR /srv/faucet

SHELL ["/bin/bash", "-c"]

# required to run some scripts as root (needed for docker)
RUN npm config set unsafe-perm true \
 && npm install

# cleanup
RUN apt-get --auto-remove remove -y --purge manpages git \
 && apt-get clean \
 && apt-get autoclean \
 && rm -rf /usr/share/doc* /usr/share/man /usr/share/postgresql/*/man /var/lib/apt/lists/* /var/cache/* /tmp/* /root/.cache /*.deb /root/.cargo

ENV FAUCET_NAME="Signet Faucet"

COPY config.example.js config.js

EXPOSE 8123

CMD ["./index.js"]
