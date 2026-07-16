FROM node:18-alpine

WORKDIR /app

# Install native dependencies for bcrypt
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm install --legacy-peer-deps

COPY . .

# Build Prisma client
RUN npx prisma generate

EXPOSE 5003

CMD ["node", "backend/server.js"]
