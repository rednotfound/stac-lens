# syntax=docker/dockerfile:1
# Builds the static site and serves it with nginx. No backend: every STAC
# request goes from the visitor's browser to the catalog they open.
#
#   docker build -t stac-lens .
#   docker run --rm -p 8080:8080 stac-lens        # http://localhost:8080
#
# Serving under a path prefix (behind a proxy that keeps the prefix):
#   docker build --build-arg VITE_BASE=/stac-lens/ -t stac-lens .
# See docs/DEPLOY.md.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG VITE_BASE=/
ENV VITE_BASE=$VITE_BASE
RUN npm run build

# Unprivileged nginx: runs as a non-root user and listens on 8080.
FROM nginxinc/nginx-unprivileged:alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
