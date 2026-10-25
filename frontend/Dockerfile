# syntax=docker/dockerfile:1
# ---- build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Map tiles: OpenStreetMap's public servers are for light development use only.
ARG VITE_MAP_TILE_URL=
ARG VITE_MAP_ATTRIBUTION=
# Public origin (sitemap, robots.txt, Open Graph) and the operator details shown on /terms and /privacy.
ARG VITE_SITE_URL=
ARG VITE_LEGAL_ENTITY=
ARG VITE_SUPPORT_EMAIL=
ARG VITE_GRIEVANCE_OFFICER=
ARG VITE_GRIEVANCE_EMAIL=
ENV VITE_API_URL= \
    VITE_DEMO_MODE=false \
    VITE_MAP_TILE_URL=$VITE_MAP_TILE_URL \
    VITE_MAP_ATTRIBUTION=$VITE_MAP_ATTRIBUTION \
    VITE_SITE_URL=$VITE_SITE_URL \
    VITE_LEGAL_ENTITY=$VITE_LEGAL_ENTITY \
    VITE_SUPPORT_EMAIL=$VITE_SUPPORT_EMAIL \
    VITE_GRIEVANCE_OFFICER=$VITE_GRIEVANCE_OFFICER \
    VITE_GRIEVANCE_EMAIL=$VITE_GRIEVANCE_EMAIL
# Source maps are kept out of the served image (upload them to your error tracker from the build stage if needed).
RUN npm run build && find dist -name '*.map' -delete

# ---- serve ----
FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
