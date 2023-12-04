FROM node:lts-bookworm-slim


# install OnlineTorrent-Backend
WORKDIR /OnlineTorrent
COPY . .
RUN cd /OnlineTorrent && npm install 

VOLUME [ "/OnlineTorrent/config" ]

CMD [ "npm", "start" ]
