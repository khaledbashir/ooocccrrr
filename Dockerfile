FROM node:20-bookworm-slim

WORKDIR /app

ENV DATABASE_URL=file:./dev.db

COPY package*.json ./
RUN npm ci

COPY . .

RUN npx prisma generate
RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push && npm run start"]
