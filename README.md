# Website 3

Third attempt at a website using everything I've learned in 2 years

## Installation

- Redirect incoming port 80 to 8010
- Redirect incoming port 443 to 8011

```
# git clone https://github.com/schleising/website3.git
# docker-compose up --build
```

Once the [`nginx`](https://nginx.org/) image is running, it will only work at that time on port 80 without SSL, to use SSL connect to the container command prompt, enter the following command and follow the instructions,

```
# certbot --nginx -d domain.com -d www.domain.com
```

Replacing `domain.com` with your domain name, this will request a certificate from [Let's Encrypt](https://letsencrypt.org/)

> :warning: There is a limit of 50 certificates per week from Let's Encrypt, so make sure the nginx image is fairly stable by the time you do this