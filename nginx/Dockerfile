FROM nginx

RUN uname -a

# Install Certbot
RUN apt-get update
RUN apt-get install -y cron vim

COPY ./nginx.conf /etc/nginx/
COPY ./cronfile.txt /
COPY ./30-run-cron.sh /docker-entrypoint.d/
RUN chmod +x /docker-entrypoint.d/30-run-cron.sh

RUN crontab cronfile.txt
