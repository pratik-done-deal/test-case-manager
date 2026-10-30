# The Test Manager web app, served by nginx, which also passes /api on to the backend: one address
# for both, so the browser needs no CORS and the event stream isn't buffered.
FROM node:22.20.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27.5-alpine
# Where the backend is, from this container: http://backend:4000 under docker compose.
ENV BACKEND_URL=http://backend:4000
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
