// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

require('dotenv').config();

var restify = require('restify');
var builder = require('botbuilder');


var https_options = {};

var fs = require('fs');
https_options = {
	key: fs.readFileSync('/etc/letsencrypt/live/tildachat.com/privkey.pem'),
    certificate: fs.readFileSync('/etc/letsencrypt/live/tildachat.com/fullchain.pem'),
};



var async = require('async');

var CronJob = require('cron').CronJob;
var job;

var mongoClient = require('mongodb').MongoClient;
var DB = null;
mongoClient.connect(process.env.MONGO_DB, function(err, db) {
	if (!err) {
		console.log('Connected');
		DB = db;
		initDB();
	}
});

var SlackClient = require('@slack/client').WebClient;
var slack = new SlackClient(process.env.BOT_USER_OAUTH_ACCESS_TOKEN);

// Setup Restify Server
var server = restify.createServer(https_options);
server.use(restify.queryParser());
server.use(restify.bodyParser());

server.listen(process.env.port || process.env.PORT || 3978, function () {
   console.log('%s listening to %s', server.name, server.url); 
});


var emojis = {
		boom: "action",
		top: "topic",
		decision: "decision",
		question: "question",
		exclamation: "answer",
		bulb: "idea",
		information_source: "info",
};

var types = ['action', 'info', 'decision', 'idea', 'question', 'answer'];

// Create chat connector for communicating with the Bot Framework Service
var connector = new builder.ChatConnector({
    appId: process.env.MICROSOFT_APP_ID,
    appPassword: process.env.MICROSOFT_APP_PASSWORD
});

// Listen for messages from users 
server.post('/api/messages', connector.listen());

server.get('/api/oauth', function (req, res, next) {
	var code = req.params.code;
	console.log(req.params);
	
	slack.oauth.access(process.env.SLACK_CLIENT_ID, process.env.SLACK_CLIENT_SECRET, code, 
	"https://tildachat.com:3978/api/oauth",
			function(err, result) {
				if (!err) {
					DB.collection("oauthtokens").update(
							{team_id: result.team_id},
							result, {upsert: true});
					var text = "<html><body>Success!";
					text += '<P>Tilda is a research project by Microsoft. By using Tilda, you agree to our <a href="https://www.microsoft.com/en-us/servicesagreement/">Terms of Use</a> and';
					text += ' <a href="https://privacy.microsoft.com/en-us/privacystatement">Privacy Statement</a>. For more info, contact us at: PrivCon_TnR@microsoft.com.</P>';
					text += '</body></html>';
					
					res.writeHead(200, {
						'Content-Length': Buffer.byteLength(text),
						'Content-Type': 'text/html'
					});
					res.write(text);
					res.end();
					next();
				}
			});
	
	
});



function initDB() {
	DB.createCollection('currentsummary', function(err, collection){});
	DB.createCollection('summary', function(err, collection){});
	DB.createCollection('session', function(err, collection){});
	DB.createCollection('channelconnection', function(err, collection){});
	DB.createCollection('channeladdress', function(err, collection){});
	DB.createCollection('channeltags', function(err, collection){});
	DB.createCollection('teamnames', function(err, collection){});
	DB.createCollection('oauthtokens', function(err, collection){});
	DB.createCollection('tildaposts', function(err, collection){});
	
	job = new CronJob('0 */20 * * * *', function() {
		var current_date = new Date();
		var older_date = new Date(current_date.getTime() - (20*60000));
		var hour_ago = new Date(current_date.getTime() - (30*60000));

		DB.collection("currentsummary").find({
			last_updated: {$lte: older_date}
				}).toArray(
				function(err, results) {
					
					if (!err && results.length != 0) {
						results.forEach(function(result) {
							var summary = result;
							var last_updated = summary.last_updated;
					
							DB.collection("oauthtokens").findOne({
							'team_id': summary.team_id,
							}, function(e3, r3) {
								if (!e3) {
									if (r3) {
										slack = new SlackClient(r3.access_token);
										if (result.channel_id.startsWith('C')) {
											slack.channels.history(
												result.channel_id,
												{count: 1},
												function(err2, result2) {
													var date = new Date(parseFloat(result2.messages[0].ts) * 1000.0);
													if (date < older_date || last_updated < hour_ago) {
														summary.end_message = result2.messages[0].ts;
														summary.meet_end = date;
														var text = 'Due to inactivity, ended conversation :end: at  _"' + result2.messages[0].text + '"_';
														var obj = end_meeting_dialog(text, date.valueOf());
														obj = {'slack': obj};
														post_to_channel(summary, result.channel_id, text, obj);
														end_existing_summary(summary);
														delete_current_summary(result.team_id, result.channel_id);
													}
												}
											);
										} else if (result.channel_id.startsWith('G')) { 
											slack.groups.history(
													result.channel_id,
													{count: 1},
													function(err2, result2) {
														var date = new Date(parseFloat(result2.messages[0].ts) * 1000.0);
														if (date < older_date || last_updated < hour_ago) {
															summary.end_message = result2.messages[0].ts;
															summary.meet_end = date;
															var text = 'Due to inactivity, ended conversation :end: at  _"' + result2.messages[0].text + '"_';
															var obj = end_meeting_dialog(text, date.valueOf());
															obj = {'slack': obj};
															post_to_channel(summary, result.channel_id, text, obj);
															end_existing_summary(summary);
															delete_current_summary(result.team_id, result.channel_id);
														}
													}
												);
										} else if (result.channel_id.startsWith('D')) { 
											slack.im.history(
													result.channel_id,
													{count: 1},
													function(err2, result2) {
														var date = new Date(parseFloat(result2.messages[0].ts) * 1000.0);
														if (date < older_date || last_updated < hour_ago) {
															summary.end_message = result2.messages[0].ts;
															summary.meet_end = date;
															var text = 'Due to inactivity, ended conversation :end: at  _"' + result2.messages[0].text + '"_';
															var obj = end_meeting_dialog(text, date.valueOf());
															obj = {'slack': obj};
															post_to_channel(summary, result.channel_id, text, obj);
															end_existing_summary(summary);
															delete_current_summary(result.team_id, result.channel_id);
														}
													}
												);
										}
									}
								}
							});
					
				});
								
					}
				});

	}, null, true, 'America/Los_Angeles');
}