FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

# Stronger fix for browser installation
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN mkdir -p /ms-playwright && \
    chmod -R 777 /ms-playwright && \
    npx playwright install --with-deps chromium

COPY . .

CMD ["npm", "start"]