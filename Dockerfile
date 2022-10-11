FROM node:18-alpine

WORKDIR /srv/faucet

COPY ./ /srv/faucet

RUN npm config set unsafe-perm true \
 && npm install \
 && npm install -g ts-node @types/node@15.6.1 typescript@4.3.2

ENV FAUCET_NAME="Signet Faucet"

COPY src/config.example.ts src/config.ts

EXPOSE 8123

CMD ["npm", "start"]
