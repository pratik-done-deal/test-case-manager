# The Test Manager API. Stateless: Postgres holds everything, so it can run as several containers.
FROM node:22.20.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22.20.0-alpine
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY scripts ./scripts
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
CMD ["node", "dist/main.js"]
