// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

var restify = require('restify');


var https_options = {};

var fs = require('fs');
https_options = {
	key: fs.readFileSync('/etc/letsencrypt/live/tildachat.com/privkey.pem'),
    certificate: fs.readFileSync('/etc/letsencrypt/live/tildachat.com/fullchain.pem'),
};


function respond(req, res, next) {
  res.send('hello ' + req.params.name);
  next();
}

// Setup Restify Server
var server = restify.createServer(https_options);


server.get('/hello/:name', respond);
server.head('/hello/:name', respond);


server.listen(8080, function () {
   console.log('%s listening to %s', server.name, server.url); 
});
