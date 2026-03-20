# Use an official Node.js runtime as a parent image
FROM node:24-alpine

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install app dependencies
RUN npm install

# Copy the rest of the application source code
COPY . .

# Expose the port the app runs on
EXPOSE 52443

# Health check to ensure the application is running
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:52443/api/info || exit 1

# Install su-exec for dropping privileges and add a non-root user
RUN apk add --no-cache su-exec && \
    addgroup -S dropgate && adduser -S dropgate -G dropgate && \
    chown -R dropgate:dropgate /usr/src/app

# Entrypoint creates uploads dir at runtime (after volume mount) then drops to dropgate
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "server.js"]
