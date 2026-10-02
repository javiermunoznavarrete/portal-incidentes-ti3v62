# Imagen mínima y endurecida: dependencias de producción, usuario sin privilegios, sin shell de compilación.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
# Ejecutar como usuario no root (CIS Docker 4.1 / ISO 27001 A.8.9)
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:${PORT:-3000}/health || exit 1
CMD ["node", "src/server.js"]
