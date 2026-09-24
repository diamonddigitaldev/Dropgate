# Use an official Node.js runtime as a parent image
FROM node:24-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install app dependencies
RUN npm ci

# Copy application source
COPY server.js ./
COPY views/ ./views/
COPY public/ ./public/

# Expose the port the app runs on
EXPOSE 52443

# Health check to ensure the application is running
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:52443/api/info || exit 1

# Install su-exec for dropping privileges and add a non-root user
RUN apk add --no-cache su-exec && \
    addgroup -S dropgate && adduser -S dropgate -G dropgate && \
    chown -R dropgate:dropgate /usr/src/app

# Entrypoint creates uploads dir at runtime then drops to dropgate
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
