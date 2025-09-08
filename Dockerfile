# Usa Node versão 20 (alpine é leve)
FROM node:20-alpine

# Cria diretório de trabalho
WORKDIR /app

# Copia package.json e package-lock.json
COPY package*.json ./

# Instala dependências
RUN npm install --production

# Copia o resto do código
COPY . .

# Expõe a porta que Fly vai usar
EXPOSE 3000

# Comando para rodar a API
CMD ["node", "server.js"]
