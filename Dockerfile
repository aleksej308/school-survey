# Приложение «Школьные опросы» (Node.js, без внешних зависимостей).
# node:sqlite встроен в Node.js, начиная с 22.5 (без флага — с 22.13).
FROM node:22-alpine

# Непривилегированный пользователь для запуска
RUN addgroup -S app && adduser -S app -G app

WORKDIR /app

# Копируем только то, что нужно в рантайме (data/ и scripts/ исключены через .dockerignore)
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY fonts ./fonts

# Каталог базы данных (монтируется как volume)
RUN mkdir -p /app/data && chown -R app:app /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/bootstrap').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER app

CMD ["node", "server.js"]
