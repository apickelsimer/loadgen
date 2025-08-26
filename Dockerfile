FROM node:18

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN npm install
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY . .

EXPOSE 8080

ENV config model.json
ENV loglevel 0

CMD ["sh", "-c", "node app.js --config ${config} --loglevel ${loglevel}"]

## example usage for a local config
## docker run -p 8080:8080 -d apickelsimer/loadgen -e config=model.json -v $PWD/config/model.json:/usr/src/app/config/model.json

## example usage for a remote config
## docker run -e config=https://storage.googleapis.com/fazio-259604.appspot.com/model.json -p 8080:8080 -d apickelsimer/loadgen 