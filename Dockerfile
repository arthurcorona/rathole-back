FROM node:22-alpine

WORKDIR /app

# Copia dependências primeiro (cache do Docker)
COPY package.json package-lock.json ./
RUN npm ci

# Copia o resto do código
COPY . .

RUN mkdir -p /app/uploads

EXPOSE 3333
# Usa tsx direto (mesmo do dev, sem precisar compilar)
CMD ["npx", "tsx", "server.ts"]
