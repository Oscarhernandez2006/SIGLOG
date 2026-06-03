FROM node:20-alpine

WORKDIR /app

# Instalar dependencias primero (mejor uso de la caché)
COPY package*.json ./
RUN npm install --omit=dev

# Copiar el resto del código
COPY . .

ENV NODE_ENV=production
ENV PORT=3005

EXPOSE 3005

CMD ["node", "server.js"]
