FROM node:20.14.0

RUN mkdir -p /app
WORKDIR /app
COPY . /app

RUN npm install -g pm2 pm2-runtime

EXPOSE 3001

CMD ["pm2-runtime","start","server.js","--name","'solcast-backend'"]
