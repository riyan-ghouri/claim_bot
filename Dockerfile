FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm ci --only=production

# === THIS IS THE MOST IMPORTANT PART ===
# Set a fixed location for browsers and install Chromium
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN mkdir -p /ms-playwright && \
    chmod -R 777 /ms-playwright && \
    npx playwright install chromium --with-deps

# Copy all your files (index.js, config.js, accounts.json, sessions folder, etc.)
COPY . .

# Start your app
CMD ["npm", "start"]