FROM node:20-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
COPY . .
RUN npm run build
CMD ["sh", "-c", "node dist/migrate.js && node dist/index.js"]
