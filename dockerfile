FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# === IMPORTANT: Install Chromium browser properly ===
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN mkdir -p /ms-playwright && \
    chmod -R 777 /ms-playwright && \
    npx playwright install chromium --with-deps

# Copy all your project files
COPY . .

# Start the application
CMD ["npm", "start"]