FROM node:lts-bookworm-slim


# install onlinetorrent-backend
WORKDIR /onlinetorrent
COPY . .
RUN cd /onlinetorrent && npm install 

VOLUME [ "/onlinetorrent/config" ]

CMD [ "npm", "start" ]
