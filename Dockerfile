FROM node:18-alpine

WORKDIR /app


COPY package*.json ./

RUN apk --no-cache add curl
RUN npm install

COPY . .

EXPOSE 8000

CMD ["node", "src/index.js"]
