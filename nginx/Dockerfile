# Start with the base nginx image
FROM nginx

# Install Cron and Certbot
# Don't install recommended packages and clear download cache to reduce the size of the image and build time
RUN apt update && \
    apt install -y --no-install-recommends cron python3-certbot-nginx vim && \
    rm -rf /var/lib/apt/lists/*

# Set up Cron to run the certbot renewal once a day
COPY ./30-run-cron.sh /docker-entrypoint.d/
COPY ./cronfile.txt /
RUN chmod +x /docker-entrypoint.d/30-run-cron.sh && \
    crontab /cronfile.txt

# Create volumes for nginx and Let's Encrypt configuration
VOLUME [ "/etc/nginx", "/etc/letsencrypt" ]

# Copy the base nginx configuration, this will be overwritten by Certbot
COPY ./nginx.conf /etc/nginx/
