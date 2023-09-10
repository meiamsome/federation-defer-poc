FROM node:20

WORKDIR /app
COPY package.json package-lock.json .
RUN npm ci --force

COPY index.js .

CMD node index.js
