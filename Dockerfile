FROM node:20

WORKDIR /app
COPY package.json .
COPY index.js .

CMD node index.js
