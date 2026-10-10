FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js storage.js market-data.js portfolio.js strategy.js strategy.css responsive.css responsive.js index.html login.html login.css login.js app.js styles.css ./
RUN mkdir -p /app/.data

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
