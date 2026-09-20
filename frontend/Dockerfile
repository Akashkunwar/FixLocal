# syntax=docker/dockerfile:1
# ---- build ----
FROM node:25-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Map tiles: OpenStreetMap's public servers are for light development use only.
ARG VITE_MAP_TILE_URL=
ARG VITE_MAP_ATTRIBUTION=
ENV VITE_API_URL= \
    VITE_DEMO_MODE=false \
    VITE_MAP_TILE_URL=$VITE_MAP_TILE_URL \
    VITE_MAP_ATTRIBUTION=$VITE_MAP_ATTRIBUTION
RUN npm run build

# ---- serve ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
