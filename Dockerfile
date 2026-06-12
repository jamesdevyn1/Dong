# Stage 1: install production dependencies (build tools needed for better-sqlite3)
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json ./
RUN npm install --omit=dev

# Stage 2: runtime image
FROM node:22-alpine AS app
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
USER node
EXPOSE 3000
CMD ["node", "src/index.js"]
