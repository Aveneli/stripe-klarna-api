FROM node:20-alpine

WORKDIR /app

# Instala ferramentas necessárias
RUN apk add --no-cache make gcc g++ python3

# Copia package.json e package-lock.json
COPY package*.json ./

# Instala dependências
RUN npm install --legacy-peer-deps

# Copia o resto do código
COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
