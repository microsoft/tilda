// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

require('dotenv').config();

var restify = require('restify');


var https_options = {};

var fs = require('fs');
https_options = {
	key: fs.readFileSync('/etc/letsencrypt/live/tildachat.com/privkey.pem'),
    certificate: fs.readFileSync('/etc/letsencrypt/live/tildachat.com/fullchain.pem'),
};

// Setup Restify Server
var server = restify.createServer(https_options);
server.use(restify.queryParser());
server.use(restify.bodyParser());

server.listen(process.env.port || process.env.PORT || 3978, function () {
   console.log('%s listening to %s', server.name, server.url); 
});
