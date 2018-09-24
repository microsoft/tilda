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
	
	slack.oauth.access(process.env.SLACK_CLIENT_ID, process.env.SLACK_CLIENT_SECRET, code, 
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

server.post('/api/events', function (req, res, next) {
	if (req.body.event.type == "reaction_added") {
		post_proactive_dialog_action(req.body);
	} else if (req.body.event.type == "star_added") {
		var channel_id = req.body.event.item.channel;
		var team_id = req.body.team_id;
		
		DB.collection("channeladdress").findOne({channel: channel_id},
				function(err, result) {
					if (!err) {
						if (result) {
							
							DB.collection("currentsummary").findOne({channel_id: channel_id},
									function(err, r2) {
										if (!err) {
											
											DB.collection("oauthtokens").findOne({
												'team_id': team_id,
												}, function(e3, r3) {
													if (!e3) {
														if (r3) {
															slack = new SlackClient(r3.access_token);
															
															if (channel_id.startsWith('C')) {
																slack.channels.history(
																	channel_id,
																	{oldest: req.body.event.item.message.ts,
																	 count: 15,	
																	},
																	function(err2, result2) {
																		send_star(err2, result2, r2, req, result, channel_id)
																	});
															
															} else if (channel_id.startsWith('G')) {
																slack.groups.history(
																		channel_id,
																		{oldest: req.body.event.item.message.ts,
																		 count: 15,	
																		},
																		function(err2, result2) {
																			send_star(err2, result2, r2, req, result, channel_id)
																		});
																	
															} else if (channel_id.startsWith('D')) {
																slack.im.history(
																		channel_id,
																		{oldest: req.body.event.item.message.ts,
																		 count: 15,	
																		},
																		function(err2, result2) {
																			send_star(err2, result2, r2, req, result, channel_id)
																		});
																	
															}
														}}});
										}});
						}}});
	}
	
	res.json(req.body);
	next();
});

function send_star(err2, result2, r2, req, result, channel_id) {
	if (result2.messages.length < 15) {
		if (r2) {
			var message = req.body.event.item.message.text;
			if (message.length > 80) {
				message = message.substring(0,80) + '...';
			}
			var text = 'Can someone label this message above with an emoji reaction?\n_"' + 
				message;
			if (req.body.event.item.message.user != 'undefined') {
				text += '"_ -<@' + req.body.event.item.message.user + '>';
			}
			var obj = post_instructions(false, text, '');
			obj = {'slack': obj};
			
			var msg = new builder.Message().address(result.address);
			msg.textLocale('en-US');
			msg.sourceEvent(obj);
			bot.send(msg);
			send_tilda_post(text, channel_id);
		} else {
			var new_text = "_Seems like an important conversation is happening. " +
			"Add notes using emoji reactions or slash commands._";		
				
			var obj2 = post_instructions(false, new_text,
					'Start a conversation with :start: ');
			obj2 = {'slack': obj2};
			
			var msg2 = new builder.Message().address(result.address);
			msg2.textLocale('en-US');
			msg2.sourceEvent(obj2);
			bot.send(msg2);
			send_tilda_post(new_text, channel_id);
		}
	}
}

function send_tilda_post(text, channel) {
	var tilda_info = {
			text: text,
			channel: channel,
			time: new Date(),
		};

	DB.collection("tildaposts").insertOne(tilda_info, function(err, res) {
		if (err) {
			console.log(err);
		}
	});
}

function post_instructions(expand, text, beginning) {
	var obj = {
			text: text,
			attachments: [
			]
	};
	
	if (expand) {
		obj.attachments.push({
			"mrkdwn_in": ["text"],
			"text": beginning + start_instructions,
			"fallback": "Upgrade your Slack client to use messages like these.",
            "attachment_type": "default",
			"callback_id": 'hide_instructions',
			"actions": [
						{
							"name": "instructions",
							"text": "Hide Instructions",
							"type": "button",
							"value": "instructions",
					}
			]
		});
	} else {
		obj.attachments.push({
						"fallback": "Upgrade your Slack client to use messages like these.",
		                "attachment_type": "default",
						"callback_id": 'show_instructions',
						"actions": [
									{
										"name": "instructions",
										"text": "See Instructions",
										"type": "button",
										"value": "instructions",
								}
						]
					});
	}
	return obj;
}

function remove_plus(obj) {
	obj.text = obj.text.replace(/\+/g, ' ');
	for (var i=0;i<obj.attachments.length;i++) {
		var attach = obj.attachments[i];
		if (attach.pretext) {
			attach.pretext = attach.pretext.replace(/\+/g, ' ');
		}
		if (attach.text) {
			attach.text = attach.text.replace(/\+/g, ' ');
		}
		if (attach.fallback) {
			attach.fallback = attach.fallback.replace(/\+/g, ' ');
		}
		if (attach.title) {
			attach.title = attach.title.replace(/\+/g, ' ');
		}
		if (attach.actions && attach.actions.length > 0) {
			for (var j=0;j<attach.actions.length;j++) {
				attach.actions[j].text = attach.actions[j].text.replace(/\+/g, ' ');
				if (attach.actions[j].options) {
					for (var k=0;k<attach.actions[j].options.length;k++) {
						attach.actions[j].options[k].text = attach.actions[j].options[k].text.replace(/\+/g, ' ');
					}
				}
				if (attach.actions[j].confirm) {
					attach.actions[j].confirm.title = attach.actions[j].confirm.title.replace(/\+/g, ' ');
					attach.actions[j].confirm.text = attach.actions[j].confirm.text.replace(/\+/g, ' ');
					attach.actions[j].confirm.ok_text = attach.actions[j].confirm.ok_text.replace(/\+/g, ' ');
				}
			}
		}
		
	}
}

server.post('/api/actions', function (req, res, next) {
	var payload = decodeURIComponent(req.body);
	payload = payload.substring(8,payload.length);
	
	var payload_json = JSON.parse(payload);
	
	var channel_id = payload_json.channel.id;
	var team_id = payload_json.team.id;
	var team_domain = payload_json.team.domain;
	var orig_message = payload_json.original_message;
	
	if (payload_json.actions[0].name == "channels_list") {
		var to_channel = payload_json.actions[0].selected_options[0].value;
		
		DB.collection("channeladdress").findOne({channel: to_channel},
				function(err, result) {
					if (!err) {
						if (result) {
							var new_card = {
							    	slack: orig_message,
							};
							remove_plus(new_card.slack);
							if (new_card.slack.text.indexOf("added ") >= 0) {
								new_card.slack.text = new_card.slack.attachments[1].pretext;
								new_card.slack.attachments[1].pretext = '';
								new_card.slack.attachments.splice(0,1);
							}
							
							var msg = new builder.Message().address(result.address);
							msg.textLocale('en-US');
							msg.sourceEvent(new_card);
							bot.send(msg);
						}
					}
			});
	
		response = {
				text: 'Sent summary to <#' + to_channel + '>. _If you don\'t see it, make sure that @tilda is a member of the channel._',
				replace_original: false,
		};
		send_tilda_post(response.text, channel_id);
		res.json(response);
		next();
	} else if (payload_json.actions[0].name == "assign_action") {
		
		var text = payload_json.original_message.attachments[0].text;
		text = text.replace(/\+/g, ' ');
		
		var id = payload_json.callback_id.split('-');
		var item = id[0];
		var time = id[1];
		var date = new Date(parseInt(time));
		
		DB.collection("currentsummary").findOne({channel_id: channel_id},
				function(err, r2) {
					if (!err) {
						var response;
						if (r2) {
							var summary = r2;
							var found = null;
							for (var i=0;i<summary[item].length;i++) {
								if (summary[item][i].text == text) {
									found = true;
									summary[item][i].assigned = payload_json.actions[0].selected_options[0].value;
									break;
								}
							}
							
							if (found != null) {
								update_current_summary(team_id, channel_id, summary);
								
								var result = payload_json.original_message;
								remove_plus(result);
								
								for (var j=0;j<result.attachments.length;j++) {
									if (result.attachments[j].text && result.attachments[j].text.startsWith('Assigned to:')) {
										result.attachments.splice(j,1);
										break;
									}
								}
								
								var obj = {
									"mrkdwn_in": ["text"],
									"color": "#FFFF00",
									'text': 'Assigned to: <@' + payload_json.actions[0].selected_options[0].value + '>',
								};
								if (result.attachments.length <= 1) {
									result.attachments.push(obj);
								} else if (result.attachments[1].text && result.attachments[1].text.startsWith('Linked to:')) {
									if (result.attachments.length > 2) {
										result.attachments.splice(2, 0, obj);
									} else{
										result.attachments.push(obj);
									}
								} else {
									result.attachments.splice(1, 0, obj);
								}
								send_tilda_post(obj.text, channel_id);
								
								res.json(result);
								next();
							} else {
								assign_to_old_summary(res, next, payload_json, team_id, channel_id, date, item, text);
							}
						} else {
							assign_to_old_summary(res, next, payload_json, team_id, channel_id, date, item, text);
						}
					}
		});
	} else if (payload_json.actions[0].name == "end_summary") {
		
		DB.collection("currentsummary").findOne({channel_id: channel_id},
				function(err, r2) {
					if (!err) {
						if (r2) {
							var summary = r2;
							var text = payload_json.original_message.attachments[0].text;
							text = text.replace(/\+/g, ' ');
							var item = payload_json.callback_id.split('-')[0];
							
							var found = false;
							for (var i=0;i<summary[item].length;i++) {
								if (summary[item][i].text == text) {
									found = true;
								}
							}
							if (found) {
								summary.end_message = payload_json.message_ts;
								summary.meet_end = new Date(parseFloat(payload_json.message_ts) * 1000.0);
								end_existing_summary(summary);
								delete_current_summary(team_id, channel_id);
			
								var text2 = "Ended conversation :end:  :small_red_triangle::small_red_triangle::small_red_triangle::small_red_triangle::small_red_triangle:";
								var time2 = new Date(parseFloat(payload_json.message_ts) * 1000.0).valueOf();
								var obj = end_meeting_dialog(text2, time2);
								obj.response_type = 'in_channel';
								obj.replace_original = false;
								res.json(obj);
								send_tilda_post(text2, channel_id);
								next();
							} else {
								var response2 = {text: 'Sorry, this summary was already ended.',
										replace_original: false
								};
								send_tilda_post(response2.text, channel_id);
								res.json(response2);
								next();
							}
						} else {
							var response3 = {text: 'Sorry, there is not a summary currently in this channel.',
									replace_original: false
							};
							send_tilda_post(response3.text, channel_id);
							res.json(response3);
							next();
						}
					}
		});
	} else if (payload_json.actions[0].name == "delete") {
		
		var text3 = payload_json.original_message.attachments[0].text;
		text3 = text3.replace(/\+/g, ' ');
		
		var id2 = payload_json.callback_id.split('-');
		var item2 = id2[0];
		var time2 = id2[1];
		var date2 = new Date(parseInt(time2));
		
		DB.collection("currentsummary").findOne({channel_id: channel_id},
				function(err, r2) {
					if (!err) {
						var response;
						if (r2) {
							var summary = r2;
							
							var found = null;
						
							for (var i=0;i<summary[item2].length;i++) {
								var x = summary[item2][i];
								if (x.text == text3) {
									found = i;
								}
							}
							if (found != null) {
								summary[item2].splice(found, 1);
								update_current_summary(team_id, channel_id, summary);
							} else {
								delete_from_old_summary(payload_json.team.domain, team_id, channel_id, date2, item2, text3);
							}
						} else {
							delete_from_old_summary(payload_json.team.domain, team_id, channel_id, date2, item2, text3);
						}
						
						response = {
								text: "Deleted this note from the summary.",
						};
						response.attachments = [
							{ 	"callback_id": 'sum-' + time2,
								"fallback": "Upgrade your Slack client to use messages like these.",
				                "attachment_type": "default",
								"actions": 
								[{
									'name': 'see_full',
									'text': 'See Summary',
									'type': 'button',
									'value': 'see_full',
								}]}];
						
						send_tilda_post(response.text, channel_id);
						res.json(response);
						next();
					}
				}
		);
				
	} else if (payload_json.actions[0].name == "expand") {
		DB.collection("summary").findOne({team_id: team_id, start_message: payload_json.callback_id},
				function(err, result) {
					if (!err) {
						if (result) {
							var result2 = create_card_expandable(result, team_domain, true, false, false);
							result2 = result2.slack;
							result2.replace_original = true;
							send_tilda_post("expand summary", channel_id);
							res.json(result2);
							next();
						} else {
							var result3 = {
									text: 'Sorry, there was an error.',
									replace_original: false,};
							send_tilda_post("expand summary - " + result3.text, channel_id);
							res.json(result3);
							next();
						}
					}
			});
	} else if (payload_json.actions[0].name == "grouped") {
		DB.collection("summary").findOne({team_id: team_id, start_message: payload_json.callback_id},
				function(err, result) {
					if (!err) {
						if (result) {
							var result2 = create_card_expandable(result, team_domain, true, false, false);
							result2 = result2.slack;
							result2.replace_original = true;
							send_tilda_post("group summary", channel_id);
							res.json(result2);
							next();
						} else {
							var result3 = {
									text: 'Sorry, there was an error.',
									replace_original: false,};
							send_tilda_post("group summary - " + result3.text, channel_id);
							res.json(result3);
							next();
						}
					}
			});
	} else if (payload_json.actions[0].name == "chronological") {
		DB.collection("summary").findOne({team_id: team_id, start_message: payload_json.callback_id},
				function(err, result) {
					if (!err) {
						if (result) {
							var result2 = create_card_chronological(result, team_domain);
							result2 = result2.slack;
							result2.replace_original = true;
							send_tilda_post("chronological summary", channel_id);
							res.json(result2);
							next();
						} else {
							var result3 = {
									text: 'Sorry, there was an error.',
									replace_original: false,};
							send_tilda_post("chronological summary - " + result3.text, channel_id);
							res.json(result3);
							next();
						}
					}
			});
	} else if (payload_json.actions[0].name == "collapse") {
		DB.collection("summary").findOne({team_id: team_id, start_message: payload_json.callback_id},
				function(err, result) {
					if (!err) {
						if (result) {
							var result2 = create_card_expandable(result, team_domain, false, false, false);
							result2 = result2.slack;
							result2.replace_original = true;
							send_tilda_post("collapse summary", channel_id);
							res.json(result2);
							next();
						} else {
							var result3 = {
									text: 'Sorry, there was an error.',
									replace_original: false,};
							send_tilda_post("collapse summary - " + result3.text, channel_id);
							res.json(result3);
							next();
						}
					}
			});
	} else if (payload_json.actions[0].name == 'hide_full') {
		remove_plus(orig_message);
		
		var last_button = orig_message.attachments[0].actions.length;
		orig_message.attachments[0].actions[last_button-1] = {
			'name': 'see_full',
			'text': 'See Summary',
			'type': 'button',
			'value': 'see_full',
		};
		if (orig_message.attachments.length > 1) {
			if (orig_message.attachments[1].text && (orig_message.attachments[1].text.startsWith('Linked to:') ||
					orig_message.attachments[1].text.startsWith('Assigned to:'))) {
				if (orig_message.attachments.length > 2 && orig_message.attachments[2].text && 
						(orig_message.attachments[2].text.startsWith('Linked to:') ||
						orig_message.attachments[2].text.startsWith('Assigned to:'))) {
					orig_message.attachments = [
						orig_message.attachments[0],
						orig_message.attachments[1],
						orig_message.attachments[2]
					];
				} else {
					orig_message.attachments = [
						orig_message.attachments[0],
						orig_message.attachments[1]
						];
				}
			} else {
				orig_message.attachments = [orig_message.attachments[0]];
			}
		} else {
			orig_message.attachments = [orig_message.attachments[0]];
		}
		send_tilda_post("hide full", channel_id);
		res.json(orig_message);
		next();

	} else if (payload_json.actions[0].name == 'see_full') {
		var id3 = payload_json.callback_id.split('-');
		var time3 = id3[1];
		var date3 = new Date(parseInt(time3) - 5000);
		
		DB.collection("currentsummary").findOne({
			channel_id: channel_id,
			'meet_start': {$lte: date3},
			},
				function(err, r2) {
					if (!err) {
						var response;
						if (r2) {
							try {
								var orig_message = payload_json.original_message;
								remove_plus(orig_message);
								var obj = create_card_expandable(r2, payload_json.team.domain, true, true, false);
	
								for (var i=0;i<obj.slack.attachments.length; i++) {
									orig_message.attachments.push(obj.slack.attachments[i]);
								}
								var last_button = orig_message.attachments[0].actions.length;
								orig_message.attachments[0].actions[last_button-1] = {
									'name': 'hide_full',
									'text': 'Hide Summary',
									'type': 'button',
									'value': 'hide_full',
								};
								res.json(orig_message);
								next();
							} catch (err) {
								var obj = {'text': err,
										'replace_original': false}
								res.json(obj);
								next();
							}
						} else {
							
							DB.collection("summary").findOne({
								'meet_end': {$gte: date3},
								'meet_start': {$lte: date3},
								'channel_id': channel_id,
								}, function(err, r2) {
									if (!err) {
										if (r2) {
											var orig_message = payload_json.original_message;
											remove_plus(orig_message);
											var obj = create_card_expandable(r2, payload_json.team.domain, true, false, true);
											
											for (var i=0;i<obj.slack.attachments.length; i++) {
												orig_message.attachments.push(obj.slack.attachments[i]);
											}
											var last_button = orig_message.attachments[0].actions.length;
											orig_message.attachments[0].actions[last_button-1] = {
												'name': 'hide_full',
												'text': 'Hide Summary',
												'type': 'button',
												'value': 'hide_full',
											};
											if (orig_message.attachments.length > 1) {
												if (orig_message.attachments[1].text && 
														orig_message.attachments[1].text.startsWith('Linked to:') && 
														orig_message.attachments.length > 2) {
													orig_message.attachments[2].pretext = obj.slack.text;
												} else {
													orig_message.attachments[1].pretext = obj.slack.text;
												}
											}
											send_tilda_post("show full", channel_id);
											res.json(orig_message);
											next();
										} else {
											var response = {text: 'Sorry, this summary was not found.', replace_original: false};
											send_tilda_post(response.text, channel_id);
											res.json(response);
											next();
										}
									}
								});
						}
					}
		});
	} else if (payload_json.actions[0].name == "undo_end") {
		var end_time = new Date(parseInt(payload_json.callback_id.split('-')[1]));
		var end_time_earlier = new Date(end_time.valueOf() - 5000);
		
		DB.collection("summary").find({
			'meet_end': {$gte: end_time_earlier},
			'channel_id': channel_id,
			}).toArray(
					function(err, results) {
						if (!err) {
							if (results.length == 1) {
								DB.collection("oauthtokens").findOne({
									'team_id': payload_json.team.id,
									}, function(e3, r3) {
										if (!e3) {
											if (r3) {
												slack = new SlackClient(r3.bot.bot_access_token);
												for (var i=0;i<results[0].ts.length; i++) {
													slack.chat.delete(
															results[0].ts[i].ts, 
															results[0].ts[i].channel,
															{},
															true,
															function(err2, result2) {
															});
												}
												
												results[0].ts = [];
												
												results[0].last_updated = new Date();
												DB.collection("currentsummary").insertOne(results[0], function(err, res) {
													if (err) {
														console.log(err);
													}
												});
												
												DB.collection("summary").remove(results[0]);
											}
										}
									});
								
								
								var response = {'text': 
									'Undid end summary. Continue adding notes to this conversation and :end: when it\'s ready.',
									'replace_original': true,
									'attachments': [
										{
											"fallback": "Upgrade your Slack client to use messages like these.",
								            "attachment_type": "default",
											'callback_id': 'undid-' + new Date().valueOf(),
											'actions': [{
														'name': 'see_full',
														'text': 'See Summary',
														'type': 'button',
														'value': 'see_full',
											}]
										}
									]
								};
								send_tilda_post(response.text, channel_id);
								res.json(response);
								next();
								
							} else {
								var response2 = {'text': 
									'Sorry, can\'t revive this summary. It\'s not the latest recorded summary from this channel.',
									'replace_original': false,
								};
								send_tilda_post(response2.text, channel_id);
								res.json(response2);
								next();
							}
						}
					});
	} else if (payload_json.actions[0].name == "instructions") {
		var text2 = payload_json.original_message.text.replace(/\+/g, ' ');
		var begin = '';
		if (text2.indexOf("Seems like ") >= 0) {
			begin = 'Start a conversation with :start: ';
		}
		var obj2;
		if (payload_json.callback_id == "hide_instructions") {
			obj2 = post_instructions(false, text2, begin);
		} else {
			obj2 = post_instructions(true, text2, begin);
		}
		res.json(obj2);
		next();
	} else if (payload_json.actions[0].name == "add_tag") {
		
		DB.collection("currentsummary").findOne({channel_id: channel_id},
				function(err, r2) {
					if (!err) {
						var response;
						if (r2) {
							var team_id = payload_json.team.id;
							
							var tag = payload_json.actions[0].selected_options[0].value;
							var found = false;
							for (var i=0;i<r2.tag.length;i++) {
								if (r2.tag[i].text == tag) {
									found = true;
									break;
								}
							}
							if (!found) {
								r2.tag.push({
									text: tag,
								});
								update_current_summary(team_id, channel_id, r2);
								var current_time = new Date().valueOf();
								var data = add_item_dialog_card(r2, 'tag-' + current_time, 'Added tag', tag, false, current_time);
								data.response_type = "in_channel";
								send_tilda_post(data.text, channel_id);
								res.json(data);
								next();
							} else {
								var obj = {text: 'This conversation already has this tag.'};
								send_tilda_post(obj.text, channel_id);
								res.json(obj);
								next();
							}
						}
					}
		});
	} else if (payload_json.actions[0].name == "link_prior") {
		
		var id4 = payload_json.callback_id.split('-');
		var item4 = id4[0];
		var time4 = id4[1];
		var date4 = new Date(parseInt(time4));
		
		var text4 = payload_json.original_message.attachments[0].text;
		text4 = text4.replace(/\+/g, ' ');
		
		DB.collection("currentsummary").findOne({channel_id: channel_id},
				function(err, r2) {
					if (!err) {
						if (r2) {
							var summary = r2;
							var from_item;
							var found = null;
							for (var i=0;i<summary[item4].length;i++) {
								var x = summary[item4][i];
								if (x.text == text4) {
									found = i;
								}
							}
							if (found != null) {
								var from_val = payload_json.actions[0].selected_options[0].value;
								var b = from_val.split('_');
								
								var to_link = item4 + '_' + summary[item4][found].id;
								
								for (var d=0;d<types.length;d++) {
									for (var e=0;e<summary[types[d]].length; e++) {
										var found_dup = null;
										if (summary[types[d]][e].to_link) {
											for (var f=0;f<summary[types[d]][e].to_link.length;f++) {
												if (summary[types[d]][e].to_link[f] == to_link) {
													found_dup = f;
													break;
												}
											}
											summary[types[d]][e].to_link.splice(f,1);
										}
									}
								}
								
								for (var c=0;c<summary[b[0]].length;c++) {
									if (summary[b[0]][c].id == b[1]) {
										from_item = summary[b[0]][c];
										if (!summary[b[0]][c].to_link) {
											summary[b[0]][c].to_link = [];
										}
										summary[b[0]][c].to_link.push(to_link);
									}
								}
								
								summary[item4][found].parent_link = from_val;
								update_current_summary(team_id, channel_id, summary);
								
								var result = payload_json.original_message;
								
								remove_plus(result);
								
								if (result.attachments.length > 1) {
									if (result.attachments[1].text && result.attachments[1].text.startsWith('Linked to:')) {
										result.attachments.splice(1,1);
									}
								}
								
								
								var obj = {
									"mrkdwn_in": ["text"],
									"color": "#FFFF00",
									'text': 'Linked to: _' + from_item.text + '_',
								};
								if (result.attachments.length <= 1) {
									result.attachments.push(obj);
								} else {
									result.attachments.splice(1, 0, obj);
								}
								send_tilda_post(obj.text, channel_id);
								res.json(result);
								next();
							} else {
								link_old_conversation(res, next, payload_json, team_id, channel_id, date4, item4, text4);
							}
						} else {
							link_old_conversation(res, next, payload_json, team_id, channel_id, date4, item4, text4);
						}
					}
				}
		);
	}
});

var start_instructions = "Write notes or add emojis to existing messages:\n" +
		"•*Topic*: Type `/~addtopic`, or add :top:\n" +
		"•*Info*: Type `/~addinfo`, or add :information_source:\n" +
		"•*Action item*: Type `/~addaction`, or add :boom:\n" +
		"•*Idea*: Type `/~addidea`, or add :bulb:\n" +
		"•*Question*: Type `/~addquestion`, or add :question:\n" +
		"•*Answer*: Type `/~addanswer`, or add :exclamation:\n" +
		"•*Decision*: Type `/~adddecision`, or add :decision:\n" +
		"•*Tag*: Add your own tag using `/~addtag`\n" +
		"`/~endmeeting`, or :end: ends the conversation and creates a summary.\n\n" + 
		"_Tilda is a research project by Microsoft. By using Tilda, you agree to our <https://www.microsoft.com/en-us/servicesagreement/|Terms of Use> and" +
		' <https://privacy.microsoft.com/en-us/privacystatement|Privacy Statement>. For more info, contact us at: PrivCon_TnR@microsoft.com._';

server.post('/api/commands', function (req, res, next) {
	var text = '';
	var id;
	var args = req.body.split('&').reduce(function(prev, curr, i, arr) {
		var p = curr.split('=');
		prev[decodeURIComponent(p[0])] = decodeURIComponent(p[1]);
		return prev;
	}, {});
	
	var channel_id = args.channel_id;
	var user = args.user_id;
	
	teamdomain_to_id(args.team_id, args.team_domain);
	
	if (args.text) {
		args.text = args.text.replace(/\+/g, ' ');
	}
	if (!args.text && args.command.indexOf('~addtag') == -1 && 
			args.command.indexOf('~start') == -1 && args.command.indexOf('~end') == -1 &&
			args.command.indexOf('~instructions') == -1 &&
			args.command.indexOf('~currentsummary') == -1) {
		var obj = {
				text: "You need to add a note after typing that slash command."
			};
			send_tilda_post(obj.text, channel_id);
			res.json(obj);
			next();
			return;
	}
	
	if (args.text && args.command.indexOf('~addtag') !== -1) {
		DB.collection("currentsummary").findOne({channel_id: args.channel_id},
				function(err, r2) {
					if (!err) {
						var current_time;
						var data;
						if (r2) {
							var found = false;
							args.text = args.text.replace(/\+/g, ' ');
							for (var i=0;i<r2.tag.length;i++) {
								if (r2.tag[i].text == args.text) {
									found = true;
								}
							}
							if (!found) {
								current_time = new Date().valueOf();
								var text = "<@" + user + "> added tag: " + args.text;
								data = add_item_dialog_card(r2, 'tag-' + current_time, text, args.text, false, current_time);
								data.response_type = "in_channel";
								send_tilda_post(text, args.channel_id);
								res.json(data);
								next();
							} else {
								var obj = {text: 'This conversation already has this tag.'};
								send_tilda_post(obj.text, args.channel_id);
								res.json(obj);
								next();
							}
						} else {
							current_time = new Date().valueOf();
							data = add_item_dialog_card(r2, 'tag-' + current_time, '<@' + user + ' added tag', args.text, false, current_time);
							data.response_type = "in_channel";
							send_tilda_post(data.text, channel_id);
							res.json(data);
							next();
						}
						return;
					}
				}
		);
	}
	
	
	if (args.command) {
		if (args.command.indexOf('~start') !== -1) {
			text = start_instructions;
		} else if (args.command.indexOf('~addinfo') !== -1) {
			text = '<@' + user + '> added info :information_source:';
			id = 'info';
		} else if (args.command.indexOf('~addaction') !== -1) {
			text = '<@' + user + '> added action :boom:';
			id = 'action';
		} else if (args.command.indexOf('~addtopic') !== -1) {
			text = '<@' + user + '> added topic :top:';
			id = 'topic';
		} else if (args.command.indexOf('~addidea') !== -1) {
			text = '<@' + user + '> added idea :bulb:';
			id = 'idea';
		} else if (args.command.indexOf('~addquestion') !== -1) {
			text = '<@' + user + '> added question :question:';
			id = 'question';
		} else if (args.command.indexOf('~addanswer') !== -1) {
			text = '<@' + user + '> added answer :exclamation:';
			id = 'answer';
		} else if (args.command.indexOf('~adddecision') !== -1) {
			text = '<@' + user + '> added decision :decision:';
			id = 'decision';
		} else if (args.command.indexOf('~end') !== -1) {
			text = "Ended conversation :end:   :small_red_triangle::small_red_triangle::small_red_triangle::small_red_triangle::small_red_triangle:";
		} else if (args.command.indexOf('~followchannel') !== -1) {
			var parts = args.text.split(' ');
			var channel_info = parts[0].split('|');
			var channel_id = channel_info[0].substring(2, channel_info[0].length);
			var people = [];
			var tags = [];
			for (var i=1; i<parts.length;i++) {
				if (parts[i].startsWith('<@')) {
					var p = parts[i].split(',');
					for (var j=0;j<p.length;j++) {
						people.push(p[j]);
					}
				} else {
					var t = parts[i].split(',');
					for (var j=0;j<t.length;j++) {
						tags.push(t[j]);
					}
				}
			}
			if (people.length == 0 && tags.length == 0) {
				text = "Summaries of conversations in <#" + channel_id + "> will be posted here.";
			} else if (people.length > 0 && tags.length == 0) {
				text = "Summaries of conversations in <#" + channel_id + "> containing participants: "
				for (var i=0;i<people.length;i++) {
					text += people[i] + ' ';
				}
				text += "will be posted here.";
			} else if (people.length == 0 && tags.length > 0) {
				text = "Summaries of conversations in <#" + channel_id + "> containing tags: "
				for (var i=0;i<tags.length;i++) {
					text += tags[i] + ' ';
				}
				text += "will be posted here.";
			} else if (people.length > 0 && tags.length > 0) {
				text = "Summaries of conversations in <#" + channel_id + "> containing tags: "
				for (var i=0;i<tags.length;i++) {
					text += tags[i] + ' ';
				}
				text += " or participants: "
				for (var i=0;i<people.length;i++) {
					text += people[i] + ' ';
				}
				text += "will be posted here.";
			}
			
			connect_two_channels(channel_id, args.channel_id, people, tags);
		} else if (args.command.indexOf('~unfollowchannel') !== -1) {
			var channel_info2 = args.text.split('|');
			var channel_id2 = channel_info2[0].substring(2, channel_info2[0].length);
			text = "No longer posting summaries of conversations in " + args.text + " here.";
			disconnect_two_channels(channel_id2, args.channel_id);
		}  else if (args.command.indexOf('~instructions') !== -1) {
			var obj2 = {
				text: start_instructions
			};
			send_tilda_post(obj2.text, channel_id);
			res.json(obj2);
			next();
			return;
		}  
	} else {
		text = args.command + '';
	}
	
	var data;
	if (text.indexOf('added ') >= 0) {
		DB.collection("currentsummary").findOne({channel_id: args.channel_id},
				function(err, r2) {
					if (!err) {
						var current_time = new Date().valueOf();
						data = add_item_dialog_card(r2, id + '-' + current_time, text, args.text, false, current_time);
						data.response_type = "in_channel";
						send_tilda_post(text, channel_id);
						res.json(data);
						next();
					}
				}
		);
	} else if (args.command.indexOf('~addtag') !== -1) {
		if (!args.text) {
			DB.collection("channeltags").find({channel_id: args.channel_id}).toArray(
					function(err, results) {
						if (!err) {
							var obj = create_tag_card(results);
							obj.response_type = 'in_channel';
							send_tilda_post(obj.text, channel_id);
							res.json(obj);
							next();
						}
					});
		}
	} else if (args.command.indexOf('~start') !== -1) {
		var obj3 = post_instructions(false, 'Started a conversation :start:  :small_red_triangle_down::small_red_triangle_down::small_red_triangle_down::small_red_triangle_down::small_red_triangle_down:', '');
		obj3.response_type = 'in_channel';
		send_tilda_post(obj3.text, channel_id);
		res.json(obj3);
		next();
	} else if (args.command.indexOf('~end') !== -1) {
		DB.collection("currentsummary").findOne({channel_id: args.channel_id},
				function(err, r2) {
					if (!err) {
						if (r2) {
							var obj = end_meeting_dialog(text, new Date().valueOf());
							obj.response_type = 'in_channel';
							send_tilda_post(text, channel_id);
							res.json(obj);
							next();
						} else {
							var obj2 = {text: 'The most recent conversation already ended.'};
							send_tilda_post(obj2.text, channel_id);
							res.json(obj2);
							next();
						}
					}
				}
		);
	} else if (args.command.indexOf('~currentsummary') !== -1) {
		DB.collection("currentsummary").findOne({
			channel_id: args.channel_id},
				function(err, r2) {
					if (!err) {
						var response;
						if (r2) {
							var obj = create_card_expandable(r2, args.team_domain, true, true, false);
							obj = obj.slack;
							obj.response_type = "ephemeral";
							obj.text = "Current notes in the summary. End conversation with `/~end` or :end:";
							send_tilda_post(obj.text, channel_id);
							res.json(obj);
							next();
							return;
						} else {
							var obj2 = {'text': 'Sorry, there is no current summary in this channel. Start one with `/~start` or :start:'};
							send_tilda_post(obj2.text, channel_id);
							res.json(obj2);
							next();
							return;
						}
					}
			});
	} else {
		data = {
		    "response_type": "in_channel",
		    "text": text,
		};
		send_tilda_post(text, channel_id);
		res.json(data);
		next();
	}
});

function assign_to_old_summary(res, next, payload_json, team_id, channel_id, date, item, text) {
	
	DB.collection("summary").findOne({
		'meet_end': {$gte: date},
		'meet_start': {$lte: date},
		'channel_id': channel_id,
		}, function(err, r2) {
			if (!err) {
				if (r2) {
					var summary = r2;
					
					var found = null;
					for (var i=0;i<summary[item].length;i++) {
						if (summary[item][i].text == text) {
							summary[item][i].assigned = payload_json.actions[0].selected_options[0].value;
							found = true;
							break;
						}
					}
					if (found != null) {
						DB.collection("summary").updateOne(
								{team_id: team_id, 
								 channel_id: channel_id,
								 start_message: summary.start_message,
								 end_message: summary.end_message
								},
								summary,
								{upsert: true},
								function(e, r) {
									if (e) {
										console.log(e);
									}
								}
						);
						
						var obj = create_card_expandable(summary, payload_json.team.domain, false, false, false);
						
						DB.collection("oauthtokens").findOne({
							'team_id': payload_json.team.id,
							}, function(e3, r3) {
								if (!e3) {
									if (r3) {
										slack = new SlackClient(r3.bot.bot_access_token);
										
										async.each(summary.ts,
											function(item, callback) {
												slack.chat.update(
													item.ts, 
													item.channel,
													obj.slack.text,
													{attachments: obj.slack.attachments},
													function(e2, r4) {
														callback();
													}
												
												);
											},
											function(err) {
												if (!err) {
													var result = payload_json.original_message;
													remove_plus(result);
													
													for (var i=0;i<result.attachments.length;i++) {
														if (result.attachments[i].text && result.attachments[i].text.startsWith('Assigned to:')) {
															result.attachments.splice(i,1);
															break;
														}
													}
													
													var obj = {
														"mrkdwn_in": ["text"],
														"color": "#FFFF00",
														'text': 'Assigned to: <@' + payload_json.actions[0].selected_options[0].value + '>',
													};
													if (result.attachments.length <= 1) {
														result.attachments.push(obj);
													} else if (result.attachments[1].text && result.attachments[1].text.startsWith('Linked to:')) {
														if (result.attachments.length > 2) {
															result.attachments.splice(2, 0, obj);
														} else{
															result.attachments.push(obj);
														}
													} else {
														result.attachments.splice(1, 0, obj);
													}
													send_tilda_post(obj.text, channel_id);
													res.json(result);
													next();
												}
											}
										);
									}
								}});
						}
						
					
				}}});
}

function link_old_conversation(res, next, payload_json, team_id, channel_id, date, item, text) {
	DB.collection("summary").findOne({
		'meet_end': {$gte: date},
		'meet_start': {$lte: date},
		'channel_id': channel_id,
		}, function(err, r2) {
			if (!err) {
				if (r2) {
					var summary = r2;
					
					var found = null;
					for (var i=0;i<summary[item].length;i++) {
						var x = summary[item][i];
						if (x.text == text) {
							found = i;
						}
					}
					if (found != null) {
						var from_item;
						var from_val = payload_json.actions[0].selected_options[0].value;
						var b = from_val.split('_');
						
						var to_link = item + '_' + summary[item][found].id;
						
						
						for (var d=0;d<types.length;d++) {
							for (var e=0;e<summary[types[d]].length; e++) {
								var found_dup = null;
								if (summary[types[d]][e].to_link) {
									for (var f=0;f<summary[types[d]][e].to_link.length;f++) {
										if (summary[types[d]][e].to_link[f] == to_link) {
											found_dup = f;
											break;
										}
									}
									summary[types[d]][e].to_link.splice(f,1);
								}
							}
						}
						
						for (var c=0;c<summary[b[0]].length;c++) {
							if (summary[b[0]][c].id == b[1]) {
								from_item = summary[b[0]][c];
								if (!summary[b[0]][c].to_link) {
									summary[b[0]][c].to_link = [];
								}
								summary[b[0]][c].to_link.push(to_link);
							}
						}
						
						
						summary[item][found].parent_link = from_val;
						
						DB.collection("summary").updateOne(
								{team_id: team_id, 
								 channel_id: channel_id,
								 start_message: summary.start_message,
								 end_message: summary.end_message
								},
								summary,
								{upsert: true},
								function(e, r) {
									if (e) {
										console.log(e);
									}
								}
						);
						
						var obj = create_card_expandable(summary, payload_json.team.domain, false, false, false);
						
						DB.collection("oauthtokens").findOne({
							'team_id': payload_json.team.id,
							}, function(e3, r3) {
								if (!e3) {
									if (r3) {
										slack = new SlackClient(r3.bot.bot_access_token);
										
										async.each(summary.ts,
												function(item, callback) {
													slack.chat.update(
														item.ts, 
														item.channel,
														obj.slack.text,
														{attachments: obj.slack.attachments},
														function(e2, r4) {
															callback();
														}
													
													);
												},
												function(err) {
													if (!err) {
										
														var result = payload_json.original_message;
														remove_plus(result);
														
														if (result.attachments.length > 1) {
															if (result.attachments[1].text && result.attachments[1].text.startsWith('Linked to:')) {
																result.attachments.splice(1,1);
															}
														}
														
														var obj = {
															"mrkdwn_in": ["text"],
															"color": "#FFFF00",
															'text': 'Linked to: _' + from_item.text + '_',
														};
														if (result.attachments.length <= 1) {
															result.attachments.push(obj);
														} else {
															result.attachments.splice(1, 0, obj);
														}
														send_tilda_post(obj.text, channel_id);
														res.json(result);
														next();
													}
												});
									}
								}
							});
					}
				}}});
}

function delete_from_old_summary(team_domain, team_id, channel_id, date, item, text) {
	
	DB.collection("summary").findOne({
		'meet_end': {$gte: date},
		'meet_start': {$lte: date},
		'channel_id': channel_id,
		}, function(err, r2) {
			if (!err) {
				if (r2) {
					var summary = r2;
					var found = null;
						
					for (var i=0;i<summary[item].length;i++) {
						var x = summary[item][i];
						if (x.text == text) {
							found = i;
						}
					}
					if (found != null) {
						summary[item].splice(found, 1);
						
						DB.collection("summary").updateOne(
								{team_id: team_id, 
								 channel_id: channel_id,
								 start_message: summary.start_message,
								 end_message: summary.end_message
								},
								summary,
								{upsert: true},
								function(err, res) {
									if (err) {
										console.log(err);
									}
								}
						);
						
						var obj = create_card_expandable(summary, team_domain, false, false, false);
						
						DB.collection("oauthtokens").findOne({
							'team_id': team_id,
							}, function(e3, r3) {
								if (!e3) {
									if (r3) {
										slack = new SlackClient(r3.bot.bot_access_token);
										for (var i=0;i<summary.ts.length; i++) {
											slack.chat.update(
													summary.ts[i].ts, 
													summary.ts[i].channel,
													obj.slack.text,
													{attachments: obj.slack.attachments},
													function(err2, result2) {
													});
										}
									}}});
					}
				}}});
}

function teamdomain_to_id(team_id, team_domain) {
	var data = {'team_id': team_id,
			'team_domain': team_domain};
	DB.collection("teamnames").update(
			data,
			data, {upsert: true});
}

function post_proactive_dialog_action(args) {
	try {
	var possible_emojis = ['start', 'end','information_source', 'boom', 'top', 'question', 'exclamation', 'bulb', 'decision'];
	
	if (args.event.type == "reaction_added" && possible_emojis.indexOf(args.event.reaction) >= 0) {
		var channel_id = args.event.item.channel;
		var team_id = args.team_id;
		
		var date = new Date(parseFloat(args.event.item.ts) * 1000.0);
		
		DB.collection("summary").findOne({
			'meet_end': {$gte: date},
			'meet_start': {$lte: date},
			'channel_id': channel_id,
			}, function(err, r2) {
				if (!err) {
					if (args.event.reaction != 'start' && args.event.reaction != 'end' && r2) {
						add_to_old_summary(r2, args);
					} else {
						DB.collection("currentsummary").findOne({channel_id: channel_id},
								function(err, r2) {
									if (!err) {
										if (r2) {
											add_to_current_summary(args, r2);
										} else {
											create_new_summary(args);
										}
									}
								}
						);
					}
					
				}
			});
	
	}
	} catch (err) {
		return err;
	}
}

function create_new_summary(args) {
	var summary = {
		"meet_start": new Date(parseFloat(args.event.item.ts) * 1000.0),
		"meet_end": null,
		"type": 'slack',
		"team_id": args.team_id,
		"channel_id": args.event.item.channel,
		"info": [],
		"action": [],
		"topic": [],
		"question": [],
		"answer": [],
		"idea": [],
		"decision": [],
		"tag": [],
		"message_count": 0,
		"word_count": 0,
		"participants": {},
		"start_message": args.event.item.ts,
		"end_message": null,
	};
	
	var text2 = 'Started conversation :start: :small_red_triangle_down::small_red_triangle_down::small_red_triangle_down::small_red_triangle_down::small_red_triangle_down:';
	var obj2 = post_instructions(false, text2, '');
	obj2 = {'slack': obj2};
	post_to_channel(summary, args.event.item.channel, text2, obj2);
	
	add_to_current_summary(args, summary);
}

function add_to_old_summary(summary, args) {
	var channel_id = args.event.item.channel;
	var team_id = args.team_id;
	
	if (args.event.reaction == "top" || 
			args.event.reaction == "boom" || 
			args.event.reaction == "information_source" ||
			args.event.reaction == "question" ||
			args.event.reaction == "exclamation" ||
			args.event.reaction == "bulb" ||
			args.event.reaction == "decision") {
	
	DB.collection("oauthtokens").findOne({
		'team_id': team_id,
		}, function(e3, r3) {
			if (!e3) {
				if (r3) {
					slack = new SlackClient(r3.access_token);
					if (channel_id.startsWith('C')) {
						slack.channels.history(
							channel_id,
							{count: 1,
							 inclusive: true,
							 latest: args.event.item.ts
							},
							function(err2, result2) {
								add_old(err2, result2, summary, args, team_id, channel_id, r3);
							});
					} else if (channel_id.startsWith('D')) {
						slack.im.history(
								channel_id,
								{count: 1,
								 inclusive: true,
								 latest: args.event.item.ts
								},
								function(err2, result2) {
									add_old(err2, result2, summary, args, team_id, channel_id, r3);
								});
					} else if (channel_id.startsWith('G')) {
						slack.groups.history(
								channel_id,
								{count: 1,
								 inclusive: true,
								 latest: args.event.item.ts
								},
								function(err2, result2) {
									add_old(err2, result2, summary, args, team_id, channel_id, r3);
								});
					}
				}
			}
		});
	}
}
	
function add_old(err2, result2, summary, args, team_id, channel_id, r3) {
	if (result2.messages.length == 1) {
		var text = result2.messages[0].text;
		var username = result2.messages[0].user;
		if (username == "undefined") {
			username = null;
		}
		var item = emojis[args.event.reaction];
			
		var found = false;
		for (var i=0;i<summary[item].length;i++) {
			if (summary[item].id == args.event.item.ts) {
				found = true;
			}
		}
		if (!found) {
			summary[item].push({
				text: text,
				user_id: username,
				id: args.event.item.ts
			});
		
			DB.collection("summary").updateOne(
					{team_id: team_id, 
					 channel_id: channel_id,
					 start_message: summary.start_message,
					 end_message: summary.end_message
					},
					summary,
					{upsert: true},
					function(err, res) {
						if (err) {
							console.log(err);
						}
					}
			);
			var message_date = new Date(parseFloat(args.event.item.ts) * 1000.0).valueOf();
			var prompt_text;
			if (username) {
				prompt_text = "<@" + args.event.user + "> added " + item + " :" + args.event.reaction + ": by <@" + username + '> to prior summary';
			} else {
				prompt_text = "<@" + args.event.user + "> added " + item + " :" + args.event.reaction + ": to prior summary";
			}
			
			var obj = add_item_dialog_card(summary, item + '-' + args.event.item.ts, 
					prompt_text, 
					text, true, message_date);
			obj = {'slack': obj};
			post_to_channel(summary, channel_id, text, obj);
			
			var obj2 = create_card_expandable(summary, args.team_domain, false, false, false);
			
			slack = new SlackClient(r3.bot.bot_access_token);
			for (var j=0;j<summary.ts.length; j++) {
				slack.chat.update(
						summary.ts[j].ts, 
						summary.ts[j].channel,
						obj2.slack.text,
						{attachments: obj2.slack.attachments},
						function(err2, result2) {
						});
			}
		}
	}
}

function add_to_current_summary(args, summary) {
	if (args.event.reaction == "top" || 
			args.event.reaction == "boom" || 
			args.event.reaction == "information_source" ||
			args.event.reaction == "start" ||
			args.event.reaction == "question" ||
			args.event.reaction == "exclamation" ||
			args.event.reaction == "bulb" ||
			args.event.reaction == "decision" ||
			args.event.reaction == "end") {
		
		var channel_id = args.event.item.channel;
		var team_id = args.team_id;
		
		DB.collection("oauthtokens").findOne({
			'team_id': team_id,
			}, function(e3, r3) {
				if (!e3) {
					if (r3) {
						slack = new SlackClient(r3.access_token);
						
						if (channel_id.startsWith('C')) {
							slack.channels.history(
								channel_id,
								{count: 1,
								 inclusive: true,
								 latest: args.event.item.ts
								},
								function(err2, result2) {
									add_curr(result2, args, summary, r3, err2, channel_id, team_id);
								});
						} else if (channel_id.startsWith('G')) {
							slack.groups.history(
									channel_id,
									{count: 1,
									 inclusive: true,
									 latest: args.event.item.ts
									},
									function(err2, result2) {
										add_curr(result2, args, summary, r3, err2, channel_id, team_id);
									});
						} else if (channel_id.startsWith('D')) {
							slack.im.history(
									channel_id,
									{count: 1,
									 inclusive: true,
									 latest: args.event.item.ts
									},
									function(err2, result2) {
										add_curr(result2, args, summary, r3, err2, channel_id, team_id);
									});
						}
				}
				}});
	}
}
	
function add_curr(result2, args, summary, r3, err2, channel_id, team_id) {
	if (result2.messages.length == 1) {
		var text = result2.messages[0].text;
		var username = result2.messages[0].user;
		if (username == "undefined") {
			username = null;
		}
		var current_time = new Date().valueOf();

		if (args.event.reaction == "top" || 
				args.event.reaction == "boom" || 
				args.event.reaction == "information_source" ||
				args.event.reaction == "question" ||
				args.event.reaction == "exclamation" ||
				args.event.reaction == "bulb" ||
				args.event.reaction == "decision") {
			var item = emojis[args.event.reaction];
			
			var found = false;
			for (var i=0;i<summary[item].length;i++) {
				if (summary[item][i].id == args.event.item.ts) {
					found = true;
				}
			}
			if (!found) {
				summary[item].push({
					text: text,
					user_id: username,
					id: args.event.item.ts,
					added_by: args.event.user,
				});

				if (parseFloat(args.event.item.ts) < parseFloat(summary.start_message)) {
					summary.start_message = args.event.item.ts;
					summary.meet_start = new Date(parseFloat(args.event.item.ts) * 1000.0);
				}
				
				update_current_summary(team_id, channel_id, summary);
				var msg_time = new Date(parseFloat(args.event.item.ts) * 1000).valueOf();
				var prompt_text;
				if (username) {
					prompt_text = "<@" + args.event.user + "> added " + item + " :" + args.event.reaction + ": by <@" + username + '>';
				} else {
					prompt_text = "<@" + args.event.user + "> added " + item + " :" + args.event.reaction + ":";
				}
				var obj = add_item_dialog_card(summary, item + '-' + current_time, 
						prompt_text, text, false,
						msg_time);
				obj = {'slack': obj};
				post_to_channel(summary, channel_id, text, obj);
			}
		} else if (args.event.reaction == "start") {
			summary.start_message = args.event.item.ts;
			summary.meet_start = new Date(parseFloat(args.event.item.ts) * 1000.0);
			update_current_summary(team_id, channel_id, summary);
			
			var text2;
			if (username) {
				text2 = 'Started conversation :start: - _"' + text + '"_ -<@' + username + '>';
			} else {
				text2 = 'Started conversation :start: - _"' + text + '"_';
			}
			var obj2 = post_instructions(false, text2, '');
			obj2 = {'slack': obj2};
			post_to_channel(summary, channel_id, text2, obj2);
		} else if (args.event.reaction == "end") {
			var date = new Date(parseFloat(args.event.item.ts) * 1000.0);
			summary.end_message = args.event.item.ts;
			summary.meet_end = date;
			
			var text3;
			if (username) {
				text3 = 'Ended conversation :end:  _"' + text + '"_ -<@' + username + '>';
			} else {
				text3 = 'Ended conversation :end:  _"' + text + '"_';
			}
			var obj3 = end_meeting_dialog(text3, date.valueOf());
			obj3 = {'slack': obj3};
			post_to_channel(summary, channel_id, text3, obj3);
			end_existing_summary(summary);
			delete_current_summary(team_id, channel_id);
		}
	}
}

function end_meeting_dialog(text, time) {
	var obj = {
			'text': text,
			'attachments': [
				{
					"fallback": "Upgrade your Slack client to use messages like these.",
		            "attachment_type": "default",
					'callback_id': 'undo-' + time,
					'actions': [
						{
							"name": "undo_end",
							"text": "Undo End",
							"type": "button",
							"value": "undo_end",
							"style": "danger",
						},
						{
							'name': 'see_full',
							'text': 'See Summary',
							'type': 'button',
							'value': 'see_full',
						}
					]
				}
			]
	};
	return obj;
}

function add_item_dialog_card(summary, id, text, message_text, old, msg_time) {
	var obj = {
			text: text,
			attachments: [
				{
					"text": message_text,
					"fallback": "Upgrade your Slack client to use messages like these.",
	                "attachment_type": "default",
					"callback_id": id,
					"actions": [
					]
				}
			]
	};
	
	if (!old) {
	if (!id.startsWith("topic") && !id.startsWith("tag") && summary) {
		var link_prior = {
				"name": "link_prior",
                "text": "Link note to prior one",
                "type": "select",
                "options": [],
		};
		var i;
		var o;
		var options = [];
		for (i=0;i<summary.info.length;i++) {
			if (summary.info[i].text != message_text) {
				o = {'text': ':information_source: ' + summary.info[i].text,
						'value': 'info_' + summary.info[i].id,
						'time': new Date(parseFloat(summary.info[i].id)*1000.0)};
				options.push(o);
			}
		}
		for (i=0;i<summary.action.length;i++) {
			if (summary.action[i].text != message_text) {
				o = {'text': ':boom: ' + summary.action[i].text,
						'value': 'action_' + summary.action[i].id,
						'time': new Date(parseFloat(summary.action[i].id)*1000.0)};
				options.push(o);
			}
		}
		for (i=0;i<summary.question.length;i++) {
			if (summary.question[i].text != message_text) {
				o = {'text': ':question: ' + summary.question[i].text,
						'value': 'question_' + summary.question[i].id,
						'time': new Date(parseFloat(summary.question[i].id)*1000.0)};
				options.push(o);
			}
		}
		for (i=0;i<summary.answer.length;i++) {
			if (summary.answer[i].text != message_text) {
				o = {'text': ':exclamation: ' + summary.answer[i].text,
						'value': 'answer_' + summary.answer[i].id,
						'time': new Date(parseFloat(summary.answer[i].id)*1000.0)};
				options.push(o);
			}
		}
		for (i=0;i<summary.idea.length;i++) {
			if (summary.idea[i].text != message_text) {
				o = {'text': ':bulb: ' + summary.idea[i].text,
						'value': 'idea_' + summary.idea[i].id,
						'time': new Date(parseFloat(summary.idea[i].id)*1000.0)};
				options.push(o);
			}
		}
		for (i=0;i<summary.decision.length;i++) {
			if (summary.decision[i].text != message_text) {
				o = {'text': ':decision: ' + summary.decision[i].text,
						'value': 'decision_' + summary.decision[i].id,
						'time': new Date(parseFloat(summary.decision[i].id)*1000.0)};
				options.push(o);
			}
		}
		
		options.sort(function(a, b) {
		    return parseFloat(b.time) - parseFloat(a.time);
		});
		
		var msg_date = new Date(parseInt(msg_time));
		
		for (i=0;i<options.length;i++) {
			if (options[i].time < msg_date) {
				link_prior.options.push({
					'text': options[i].text,
					'value': options[i].value,
				});
			}
		}
		
		if (link_prior.options.length > 0) {
			obj.attachments[0].actions.push(link_prior);
		}
	}
	
	if (id.startsWith("action")) {
		obj.attachments[0].actions.push(
				 {
	                 "name": "assign_action",
	                 "text": "Assign to",
	                 "type": "select",
	                 "data_source": "users"
	             }
		);
	}
	

	obj.attachments[0].actions.push(
			{
				"name": "delete",
				"text": "Delete",
				"type": "button",
				"value": "delete",
				"style": "danger",
				"confirm": {
					"title": "Are you sure?",
					"text": "Delete this note from the summary.",
					"ok_text": "Yes, delete it",
					"dismiss_text": "No",
				}
			});
	
		obj.attachments[0].actions.push(
				{
					"name": "end_summary",
					"text": "End Summary",
					"type": "button",
					"value": "end_summary",
				});
			obj.attachments[0].actions.push(
				{
					'name': 'see_full',
					'text': 'See Summary',
					'type': 'button',
					'value': 'see_full',
				});
	}

	return obj;
}

function post_to_channel(summary, channel, text, obj) {
	DB.collection("channeladdress").findOne({channel: channel},
			function(err, result) {
				if (!err) {
					if (result) {
						var msg = new builder.Message().address(result.address);
						msg.textLocale('en-US');
						if (obj) {
							msg.sourceEvent(obj);
						} else {
							msg.text(text);
						}
						bot.send(msg);
						
						if (obj) {
							send_tilda_post(obj.slack.text, channel); 
						} else {
							send_tilda_post(text, channel);
						}
					}
				}
		});
}



function connect_two_channels(orig_channel, sum_channel, people, tags) {
	var data = {'orig_channel': orig_channel,
			'sum_channel': sum_channel,
			'people': people,
			'tags': tags,
			};
	DB.collection("channelconnection").update(
			{'orig_channel': orig_channel,
			'sum_channel': sum_channel},
			data, {upsert: true});
}

function disconnect_two_channels(orig_channel, sum_channel) {
	var data = {'orig_channel': orig_channel,
			'sum_channel': sum_channel};
	DB.collection("channelconnection").remove(data);
}

function extract_text_command(session, command, name, current_summary, emoji) {
	var channel_id = session.message.sourceEvent.SlackMessage.channel;
	var text = session.message.sourceEvent.SlackMessage.text;
	var new_text;
	if (text.indexOf(command) >= 0) {
		new_text = text.substring(command.length + text.indexOf(command), text.length).replace(/^\s+|\s+$/g, '');
	} else {
		new_text = text;
		new_text = new_text.replace(':boom:', ' ');
		new_text = new_text.replace(':action:', ' ');
		new_text = new_text.replace(':information_source:', ' ');
		new_text = new_text.replace(':info:', ' ');
		new_text = new_text.replace(':idea:', ' ');
		new_text = new_text.replace(':bulb:', ' ');
		new_text = new_text.replace(':question:', ' ');
		new_text = new_text.replace(':answer:', ' ');
		new_text = new_text.replace(':exclamation:', ' ');
		new_text = new_text.replace(':decision:', ' ');
		new_text = new_text.replace(':top:', ' ');
		new_text = new_text.replace(':topic:', ' ');
		new_text = new_text.replace(/^\s+|\s+$/g, '');
	}
	
	if (new_text != '') {
		var found = false;
		for (var i=0; i<current_summary[name].length; i++) {
			if (current_summary[name][i].text == new_text) {
				found = true;
			}
		}
		var user = session.message.user.id.split(':')[0];
		if (!(name == 'tag' && found)) {
			current_summary[name].push({
				text: new_text,
				user: null,
				id: session.message.sourceEvent.SlackMessage.ts,
				added_by: user,
			});
		
			if (name == "tag") {
				var data = {'channel_id': channel_id,
						'tag': new_text};
				DB.collection("channeltags").update(
						data,
						data, {upsert: true});
			}

			if (text.indexOf('/~add') < 0 || text.indexOf(':' + emoji + ':') >= 0) {
				if (emoji) {
					text = '<@' + user + '> added ' + name + ' :' + emoji + ':';
				} else {
					text = '<@' + user + '> added ' + name;
				}
				var msg = new builder.Message(session);
				var current_time = new Date().valueOf();
				var msg_time = new Date(parseFloat(session.message.sourceEvent.SlackMessage.ts) * 1000.0).valueOf();
				var obj = add_item_dialog_card(current_summary, name + '-' + current_time, text, new_text, false, msg_time);
				obj.response_type = "in_channel";
				obj = {'slack': obj};
				msg.sourceEvent(obj);
				session.send(msg);
			}
		}
	} else if (name == "tag" && text.indexOf('/~add') < 0) {
		add_tag_card(channel_id, session);
	} 
}

function create_tag_card(results) {
	var obj;
	if (results.length > 0) {
		obj = {
				'text': 'Add a tag to this conversation:',
				'attachments': [
					{
						'callback_id': 'add_tag',
						"attachment_type": "default",
						actions: [
							{
								"name": "add_tag",
				                "text": "Add existing tag",
				                "type": "select",
				                "options": [],
							}
						]
					}
				]
		};
		
		var tags = [];
		results.forEach(function(result) {
			obj.attachments[0].actions[0].options.push({
				'text': result.tag,
				'value': result.tag,
			});
		});
	
		
	} else {
		obj = {
				'text': 'No existing tags in this channel. Add one with `/~addtag [tag]`.',
		};
	} 
	return obj;
}

function add_tag_card(channel, session) {
	DB.collection("channeltags").find({channel_id: channel}).toArray(
			function(err, results) {
			var obj;
				if (!err) {
					obj = create_tag_card(results);
					var msg = new builder.Message(session);
					obj.response_type = "in_channel";
					obj = {'slack': obj};
					msg.sourceEvent(obj);
					session.send(msg);
				}
	});
}

function pad(num, size) {
	var s = num+'';
	while (s.length < size) s= "0" + s;
	return s;
}

function add_answer_to_question(count, channel_id, team_domain, str, answer_link, summary, expand) {
	var shortened = false;
	for (var j=0;j<answer_link.length;j++) {
		
		if (count > 2) {
			shortened = true;
			if (!expand) {
				break;
			}
		}
		
		var b = answer_link[j].split('_');
		for (var i=0;i<summary[b[0]].length; i++) {
			if (summary[b[0]][i].id == b[1]) {
				str += '>';
				var id_r = summary[b[0]][i].id.replace('.','');
				str += '<https://' + team_domain + '.slack.com/archives/' + channel_id + 
				'/p' + id_r + '|' + b[0].charAt(0).toUpperCase() + b[0].slice(1) + '>: ';
				
				if (b[0] == 'action' && summary[b[0]][i].assigned) {
					str += 'Assigned to <@' + summary[b[0]][i].assigned + '> - ';
				}
				var temp_s;
				if (!expand) {
					temp_s = String(summary[b[0]][i].text).replace(/^\s+|\s+$/g, '');
					if (temp_s.length > 140) {
						temp_s = temp_s.substring(0,140) + '...';
						shortened = true;
					}
					str += temp_s;
				} else {
					temp_s = String(summary[b[0]][i].text).replace(/^\s+|\s+$/g, '');
					if (temp_s.length > 140) {
						shortened = true;
					}
					str += temp_s;
				}
				if (summary[b[0]][i].user_id) {
					str2 += ' -<@' + summary[b[0]][i].user_id + '>';
				} else if (summary[b[0]][i].user) {
					str += ' -<@' + summary[b[0]][i].user + '>';
				}
				str += '\n';
				count += 1;
				
				if (summary[b[0]][i].to_link) {
					if (count > 2) {
						shortened = true;
					} 
					if (expand || count <= 2) {
						var r = add_answer_to_question(count, channel_id, team_domain, str, summary[b[0]][i].to_link, summary, expand);
						str = r[0];
						shortened = shortened || r[1];
						count = r[2];
					}
				}
			}
		}
	}
	return [str, shortened, count];
}

function create_card_obj(category_count, summary, attachment_list, type_list, name, color, emoji, team_domain, channel_id, expand) {
	var shortened = false;
	 if (type_list.length > 0) {
	    	var obj = {};
	    	var str = name + ': ';
	    	var str2 = '';
	    	var count = 0;
			for (var i=0; i<type_list.length; i++) {
				if (type_list[i].parent_link) {
					continue;
				}
				if (count > 1) {
					shortened = true;
					if (!expand) {
						break;
					}
				}
				if (category_count > 1) {
					shortened = true;
					if (!expand) {
						break;
					}
				}
				
				str += type_list[i].text + ', ';
				var id_r = type_list[i].id.replace('.','');
				str2 += '<https://' + team_domain + '.slack.com/archives/' + channel_id + 
				'/p' + id_r + '|' + (i+1) + '>. ';
				
				if (name == 'Action' && type_list[i].assigned) {
					str2 += 'Assigned to <@' + type_list[i].assigned + '> - ';
				}
				
				var temp_s;
				if (!expand) {
					temp_s = String(type_list[i].text).replace(/^\s+|\s+$/g, '');
					if (temp_s.length > 140) {
						temp_s = temp_s.substring(0,140) + '...';
						shortened = true;
					}
					str2 += temp_s;
				} else {
					temp_s = String(type_list[i].text).replace(/^\s+|\s+$/g, '');
					if (temp_s.length > 140) {
						shortened = true;
					}
					str2 += temp_s;
				}
				if (type_list[i].user_id) {
					str2 += ' -<@' + type_list[i].user_id + '>';
				} else if (type_list[i].user) {
					str2 += ' -<@' + type_list[i].user + '>';
				}
				str2 += '\n';
				count += 1;
				
				if (type_list[i].to_link) {
					var r = add_answer_to_question(count, channel_id, team_domain, str2, type_list[i].to_link, summary, expand);
					str2 = r[0];
					shortened = shortened || r[1];
					count = r[2];
				}
			}
			if (count > 0) {
				str = str.substring(0,str.length -2);
				obj.color = color;
				obj.fallback = str;
				obj.title = name + " :" + emoji + ":";
				obj.text = str2;
				obj.mrkdwn_in = ["text"];
				attachment_list.push(obj);
			}
			if (count > 0) {
				return [count, shortened, 1];
			} else {
				return [count, shortened, 0];
			}
	    }
	 return [0, shortened, 0];
}

function create_card_chronological(current_summary, team_domain) {
	var pretext = '';
	var text = '';
	
	var tags = '';
	if (current_summary.tag.length > 0) {
		var str = '*Tags*: ';
		for (var i=0; i<current_summary.tag.length; i++) {
			str += current_summary.tag[i].text + ', ';
		}
		str = str.substring(0,str.length -2);
		tags = str;
	}
	text += tags;
	
	var date_start = new Date(current_summary.meet_start);
    var date_end = new Date(current_summary.meet_end);
    var start_message = current_summary.start_message.replace('.', '');
    var end_message = current_summary.end_message.replace('.', '');
    
    if (current_summary.channel_id[0] == "C") {
    	pretext = "Summary <#" + current_summary.channel_id + "> ";
    } else {
    	pretext = "Summary from private channel ";
    }
    
    pretext += date_start.toLocaleDateString("en-US") + 
		" from <!date^" + start_message.substring(0,10) + "^{time}^https://" + team_domain + ".slack.com/archives/" + current_summary.channel_id + '/p' + start_message + '|' +
		pad(date_start.getHours(), 2) + ":" + pad(date_start.getMinutes(), 2) + 
		"> to <!date^" + end_message.substring(0,10) + "^{time}^https://" + team_domain + ".slack.com/archives/" + current_summary.channel_id + '/p' + end_message + '|' + 
		pad(date_end.getHours(), 2) + ":" + pad(date_end.getMinutes(), 2) + '>';
    
    var count = '';
    if (current_summary.message_count == 1) {
    	count += '1 message, ';
    } else {
    	count += current_summary.message_count + ' messages, ';
    }
	if (current_summary.reading_time.toFixed(2) + '' == '0.00') {
		count += ' 0.01 min read';
	} else {
		count += current_summary.reading_time.toFixed(2) + ' min read';
	}
	var part = '*People*: ' + current_summary.top_participants;
	var part_count = Object.keys(current_summary.participants).length;
	if (part_count > 3) {
		part = part + ', '+ part_count + ' in total';
	}
	
	if (tags) {
		text += '\n' + part + '\n' + count;
	} else {
		text += part + '\n' + count;
	}
	
    result = {
    	slack: {
    		"text": pretext,
    		"response_type": "in_channel",
    		"attachments": [
    		]
    	}
    };
    
	var pre_info = {
			"fallback": text,
			"mrkdwn_in": ["text"],
			'text': text,
			'unfurl_links': false,
		};

	var title = '';
    if (current_summary.topic.length > 0) {
    	var str2 = 'Topic: ';
		for (var j=0; j<current_summary.topic.length; j++) {
			str2 += String(current_summary.topic[j].text).replace(/^\s+|\s+$/g, '');
			if (current_summary.topic[j].user_id) {
				str2 += ' -<@' + current_summary.topic[j].user_id + '>';
			} else if (current_summary.topic[j].user) {
				str2 += ' -<@' + current_summary.topic[j].user + '>';
			}
			str2 += ', ';
		}
		str2 = str2.substring(0,str2.length -2);
		str2 += ' :top:';
		title = str2;
    }
    if (title || text) {
    	result.slack.attachments.push(pre_info);
    	if (title) {
    		result.slack.attachments[0].fallback = title;
    		result.slack.attachments[0].title = title;
    	}
    }
    
    var all_notes = [];
    
    for (var i=0;i<current_summary.action.length;i++) {
    	var o = {'type': 'action',
    			 'text': current_summary.action[i].text,
    			 'user': current_summary.action[i].user,
    			 'user_id': current_summary.action[i].user_id,
    			 'id': current_summary.action[i].id,
    			 'parent_link': current_summary.action[i].parent_link,
    			 'to_link': current_summary.action[i].to_link,
    			 'assigned': current_summary.action[i].assigned,
    	};
    	all_notes.push(o);
    }
    for (var i=0;i<current_summary.decision.length;i++) {
    	var o = {'type': 'decision',
    			 'text': current_summary.decision[i].text,
    			 'user': current_summary.decision[i].user,
    			 'user_id': current_summary.decision[i].user_id,
    			 'id': current_summary.decision[i].id,
    			 'parent_link': current_summary.decision[i].parent_link,
    			 'to_link': current_summary.decision[i].to_link,
    			 'assigned': current_summary.decision[i].assigned,
    	};
    	all_notes.push(o);
    }
    for (var i=0;i<current_summary.question.length;i++) {
    	var o = {'type': 'question',
    			 'text': current_summary.question[i].text,
    			 'user': current_summary.question[i].user,
    			 'user_id': current_summary.question[i].user_id,
    			 'id': current_summary.question[i].id,
    			 'parent_link': current_summary.question[i].parent_link,
    			 'to_link': current_summary.question[i].to_link,
    			 'assigned': current_summary.question[i].assigned,
    	};
    	all_notes.push(o);
    }
    for (var i=0;i<current_summary.answer.length;i++) {
    	var o = {'type': 'answer',
   			 'text': current_summary.answer[i].text,
   			 'user': current_summary.answer[i].user,
   			'user_id': current_summary.answer[i].user_id,
   			 'id': current_summary.answer[i].id,
   			 'parent_link': current_summary.answer[i].parent_link,
   			 'to_link': current_summary.answer[i].to_link,
   			'assigned': current_summary.answer[i].assigned,
   	};
   	all_notes.push(o);
    }
    for (var i=0;i<current_summary.idea.length;i++) {
	   	var o = {'type': 'idea',
				 'text': current_summary.idea[i].text,
				 'user': current_summary.idea[i].user,
				 'user_id': current_summary.idea[i].user_id,
				 'id': current_summary.idea[i].id,
				 'parent_link': current_summary.idea[i].parent_link,
				 'to_link': current_summary.idea[i].to_link,
				 'assigned': current_summary.idea[i].assigned,
		};
		all_notes.push(o);
    }
    for (var i=0;i<current_summary.info.length;i++) {
		var o = {'type': 'info',
				 'text': current_summary.info[i].text,
				 'user': current_summary.info[i].user,
				 'user_id': current_summary.info[i].user_id,
				 'id': current_summary.info[i].id,
				 'parent_link': current_summary.info[i].parent_link,
				 'to_link': current_summary.info[i].to_link,
				 'assigned': current_summary.info[i].assigned,
		};
		all_notes.push(o);
    }
    
    all_notes.sort(function(a, b) {
		return parseFloat(a.id) - parseFloat(b.id);
	});

	create_card_notes(current_summary, result.slack.attachments, 
    		all_notes, team_domain, current_summary.channel_id);

    var menu = {
                "fallback": "Upgrade your Slack client to use messages like these.",
                "attachment_type": "default",
                "callback_id": current_summary.start_message,
                "actions": [
                ]
            };
    menu.actions.push({
        "name": "channels_list",
        "text": "Send to channel",
        "type": "select",
        "data_source": "channels"
    });
	menu.actions.push({
		"name": "grouped",
		"text": "View Grouped",
		"type": "button",
		"value": "grouped",
	});
	menu.actions.push({
    	"name": "collapse",
		"text": "Collapse",
		"type": "button",
		"value": "collapse",
    });
    result.slack.attachments.push(menu);
    return result;
}

function create_card_notes(current_summary, attachment_list, all_notes, team_domain, channel_id) {
	var prev_type = null;
	var count = 0;
	for (var i=0; i<all_notes.length; i++) {
		if (all_notes[i].parent_link) {
			continue;
		}

		var str2 = '';
		
		var id_r = all_notes[i].id.replace('.','');
		if (!prev_type || prev_type != all_notes[i].type) {
			str2 += '<https://' + team_domain + '.slack.com/archives/' + channel_id + 
			'/p' + id_r + '|' + all_notes[i].type.charAt(0).toUpperCase() + all_notes[i].type.slice(1) + '>: ';
		} else {
			str2 += '<https://' + team_domain + '.slack.com/archives/' + channel_id + 
			'/p' + id_r + '|' + (count+1) + '>: ';
		}
		
		if (all_notes[i].type == 'action' && all_notes[i].assigned) {
			str2 += 'Assigned to <@' + all_notes[i].assigned + '> - ';
		}
		
		var temp_s;
		temp_s = String(all_notes[i].text).replace(/^\s+|\s+$/g, '');
		str2 += temp_s;
		
		if (all_notes[i].user_id) {
			str2 += ' -<@' + all_notes[i].user_id + '>';
		} else if (all_notes[i].user) {
			str2 += ' -<@' + all_notes[i].user + '>';
		}
		str2 += '\n';
		count += 1;
		
		if (all_notes[i].to_link) {
			var r = add_answer_to_question_chron(channel_id, team_domain, str2, all_notes[i].to_link, current_summary, count);
			str2 = r[0];
			count = r[1];
		}
		if (!prev_type || prev_type != all_notes[i].type) {
			var obj = {};
			if (all_notes[i].type == "action") {
				obj.color = "#0000FF";
			} else if (all_notes[i].type == "decision") {
				obj.color = "#FFA500";
			} else if (all_notes[i].type == "question") {
				obj.color = "#FF0000";
			} else if (all_notes[i].type == "answer") {
				obj.color = "#000000";
			} else if (all_notes[i].type == "idea") {
				obj.color = "#FFFF00";
			} else if (all_notes[i].type == "info") {
				obj.color = "#36a64f";
			}
			obj.fallback = '';
			obj.text = str2;
			obj.mrkdwn_in = ["text"];
			attachment_list.push(obj);
		} else {
			var obj = attachment_list[attachment_list.length - 1];
			obj.text += str2;
		}
		
		prev_type = all_notes[i].type;
	}
}

function add_answer_to_question_chron(channel_id, team_domain, str, answer_link, summary, count) {
		for (var j=0;j<answer_link.length;j++) {
			
			var b = answer_link[j].split('_');
			for (var i=0;i<summary[b[0]].length; i++) {
				if (summary[b[0]][i].id == b[1]) {
					str += '>';
					var id_r = summary[b[0]][i].id.replace('.','');
					str += '<https://' + team_domain + '.slack.com/archives/' + channel_id + 
					'/p' + id_r + '|' + b[0].charAt(0).toUpperCase() + b[0].slice(1) + '>: ';
					
					if (b[0] == 'action' && summary[b[0]][i].assigned) {
						str += 'Assigned to <@' + summary[b[0]][i].assigned + '> - ';
					}
					var temp_s;
					temp_s = String(summary[b[0]][i].text).replace(/^\s+|\s+$/g, '');
					str += temp_s;

					if (summary[b[0]][i].user_id) {
						str += ' -<@' + summary[b[0]][i].user_id + '>';
					} else if (summary[b[0]][i].user) {
						str += ' -<@' + summary[b[0]][i].user + '>';
					}
					str += '\n';
					count += 1;
					
					if (summary[b[0]][i].to_link) {
						var r = add_answer_to_question_chron(channel_id, team_domain, str, summary[b[0]][i].to_link, summary, count);
						str = r[0];
						count = r[1];
					}
				}
			}
		}
		return [str, count];
}

function create_card_expandable(current_summary, team_domain, expand, partial, remove_attachments) {
	var pretext = '';
	var text = '';
	
	var tags = '';
	if (current_summary.tag.length > 0) {
		var str = '*Tags*: ';
		for (var i=0; i<current_summary.tag.length; i++) {
			str += current_summary.tag[i].text + ', ';
		}
		str = str.substring(0,str.length -2);
		tags = str;
	}
	text += tags;
	
	if (!partial) {
		var date_start = new Date(current_summary.meet_start);
	    var date_end = new Date(current_summary.meet_end);
	    var start_message = current_summary.start_message.replace('.', '');
	    var end_message = current_summary.end_message.replace('.', '');
	    
	    if (current_summary.channel_id[0] == "C") {
	    	pretext = "Summary <#" + current_summary.channel_id + "> ";
	    } else {
	    	pretext = "Summary from private channel ";
	    }
	    
	    pretext += date_start.toLocaleDateString("en-US") + 
			" from <!date^" + start_message.substring(0,10) + "^{time}^https://" + team_domain + ".slack.com/archives/" + current_summary.channel_id + '/p' + start_message + '|' +
			pad(date_start.getHours(), 2) + ":" + pad(date_start.getMinutes(), 2) + 
			"> to <!date^" + end_message.substring(0,10) + "^{time}^https://" + team_domain + ".slack.com/archives/" + current_summary.channel_id + '/p' + end_message + '|' + 
			pad(date_end.getHours(), 2) + ":" + pad(date_end.getMinutes(), 2) + '>';
	    
	    var count = '';
	    if (current_summary.message_count == 1) {
	    	count += '1 message, ';
	    } else {
	    	count += current_summary.message_count + ' messages, ';
	    }
		if (current_summary.reading_time.toFixed(2) + '' == '0.00') {
			count += ' 0.01 min read';
		} else {
			count += current_summary.reading_time.toFixed(2) + ' min read';
		}
		var part = '*People*: ' + current_summary.top_participants;
		var part_count = Object.keys(current_summary.participants).length;
		if (part_count > 3) {
			part = part + ', '+ part_count + ' in total';
		}
		
		if (tags) {
			text += '\n' + part + '\n' + count;
		} else {
			text += part + '\n' + count;
		}
	}
	
    result = {
    	slack: {
    		"text": pretext,
    		"response_type": "in_channel",
    		"attachments": [
    		]
    	}
    };
    
	var pre_info = {
			"fallback": text,
			"mrkdwn_in": ["text"],
			'text': text,
			'unfurl_links': false,
		};

	var title = '';
    if (current_summary.topic.length > 0) {
    	var str2 = 'Topic: ';
		for (var j=0; j<current_summary.topic.length; j++) {
			str2 += String(current_summary.topic[j].text).replace(/^\s+|\s+$/g, '');
			if (current_summary.topic[j].user_id) {
				str2 += ' -<@' + current_summary.topic[j].user_id + '>';
			} else if (current_summary.topic[j].user) {
				str2 += ' -<@' + current_summary.topic[j].user + '>';
			}
			str2 += ', ';
		}
		str2 = str2.substring(0,str2.length -2);
		str2 += ' :top:';
		title = str2;
    }
    if (title || text) {
    	result.slack.attachments.push(pre_info);
    	if (title) {
    		result.slack.attachments[0].fallback = title;
    		result.slack.attachments[0].title = title;
    	}
    }
    
    var expandable = false;
    var curr_count = 0;
    var category_count = 0;
    
	var ret = create_card_obj(category_count, current_summary, result.slack.attachments, 
    		current_summary.action, 'Action', '#0000FF', 'boom', 
    		team_domain, current_summary.channel_id, expand);
	curr_count += ret[0];
    expandable = expandable || ret[1];
    category_count += ret[2];

	ret = create_card_obj(category_count, current_summary, result.slack.attachments, 
    		current_summary.decision, 'Decision', '#FFA500', 'decision', 
    		team_domain, current_summary.channel_id, expand);
	curr_count += ret[0];
    expandable = expandable || ret[1];
    category_count += ret[2];
    
	ret = create_card_obj(category_count, current_summary, result.slack.attachments, 
    		current_summary.question, 'Question', '#FF0000', 'question', 
    		team_domain, current_summary.channel_id, expand);
	curr_count += ret[0];
    expandable = expandable || ret[1];
    category_count += ret[2];
    
	ret = create_card_obj(category_count, current_summary, result.slack.attachments, 
    		current_summary.answer, 'Answer', '#000000', 'exclamation', 
    		team_domain, current_summary.channel_id, expand);
	curr_count += ret[0];
    expandable = expandable || ret[1];
    category_count += ret[2];
    
	ret = create_card_obj(category_count, current_summary, result.slack.attachments, 
    		current_summary.idea, 'Idea', '#FFFF00', 'bulb', 
    		team_domain, current_summary.channel_id, expand);
	curr_count += ret[0];
    expandable = expandable || ret[1];
    category_count += ret[2];

	ret = create_card_obj(category_count, current_summary, result.slack.attachments, 
    		current_summary.info, 'Info', '#36a64f', 'information_source', 
    		team_domain, current_summary.channel_id, expand);
	curr_count += ret[0];
    expandable = expandable || ret[1];
    category_count += ret[2];
    
    if (!partial && !remove_attachments) {
	    var menu = {
	                "fallback": "Upgrade your Slack client to use messages like these.",
	                "attachment_type": "default",
	                "callback_id": current_summary.start_message,
	                "actions": [
	                ]
	            };
    
        menu.actions.push({
            "name": "channels_list",
            "text": "Send to channel",
            "type": "select",
            "data_source": "channels"
        });

		    if (expandable && !expand) {
		    	var total_count = current_summary.answer.length + current_summary.question.length + current_summary.action.length +
		    						current_summary.idea.length + current_summary.info.length + current_summary.decision.length;
		    	var remainder = total_count - curr_count;
		    	
		    	if (remainder > 0) {
			    	menu.actions.push({
			        	"name": "expand",
						"text": "Expand (" + remainder + " more)",
						"type": "button",
						"value": "expand",
			        });
		    	} else {
		    		menu.actions.push({
			        	"name": "expand",
						"text": "Expand",
						"type": "button",
						"value": "expand",
			        });
		    	}
		    } else if (expandable && expand) {
		    	if (category_count > 1) {
			    	menu.actions.push({
			    		"name": "chronological",
						"text": "View Chronological",
						"type": "button",
						"value": "chronological",
			    	});
		    	}
		    	menu.actions.push({
		        	"name": "collapse",
					"text": "Collapse",
					"type": "button",
					"value": "collapse",
		        });
		    }
	    result.slack.attachments.push(menu);
	}
    return result;
}

function send_proactive_message(current_summary) {
	var channel_id = current_summary.channel_id;
	
	DB.collection("channelconnection").find({orig_channel: channel_id}).toArray(
			function(err, results) {
		if (!err && results.length != 0) {
			
			async.each(results,
				function(result, callback) {
				
					var found = false;
					if (!result.people && !result.tags) {
						found = true;
					}
					if (result.people && result.people.length == 0 && result.tags && result.tags.length == 0) {
						found = true;
					}
					if (!found && result.people) {
						for (var i=0;i<result.people.length;i++) {
							var part = result.people[i].split('|')[0];
							part = part.substring(2, part.length);
							if (part in current_summary.participants) {
								found = true;
								break;
							}
						}
					}
					if (!found && result.tags) {
						for (var i=0;i<result.tags.length;i++) {
							for (var j=0; j<current_summary.tag.length;j++) {
								if (result.tags[i] == current_summary.tag[j].text) {
									found = true;
									break;
								}
							}
						}
					}
					if (!found) {
						callback();
					} else {
					DB.collection("teamnames").findOne({team_id: current_summary.team_id},
							function(err, rr) {
								if (!err) {
									if (rr) {
										var team_domain = rr.team_domain;
										var obj = create_card_expandable(current_summary, team_domain, false, false, false);
									    
										DB.collection("oauthtokens").findOne({
													'team_id': current_summary.team_id,
													}, function(e3, r3) {
														if (!e3) {
															if (r3) {
																slack = new SlackClient(r3.bot.bot_access_token);
																
																send_tilda_post("post summary to " + result.sum_channel, current_summary.channel_id);
										
																slack.chat.postMessage(result.sum_channel, 
																		obj.slack.text, {attachments: obj.slack.attachments}, 
																		function(err, result3) {
																			if (!err) {
																				if (!current_summary.ts) {
																					current_summary.ts = [];
																				}
																				current_summary.ts.push({channel: result.sum_channel, 
																					ts: result3.ts});
																				callback();
																			}
																		});
															}}});
									}
								}
						});
					}
					
					
			}, function (err) {
				if (!err) {
					
					DB.collection("summary").updateOne(
							{	
								team_id: current_summary.team_id,
								channel_id: current_summary.channel_id,
								start_message: current_summary.start_message,
							},
							current_summary, 
							{upsert: true},
							function(err, res) {
								if (err) {
									console.log(err);
								}
							}
					);
				}
			}
			);
		} else {
			
			DB.collection("teamnames").findOne({team_id: current_summary.team_id},
					function(err, rr) {
						if (!err) {
							if (rr) {
								var team_domain = rr.team_domain;
								var obj = create_card_expandable(current_summary, team_domain, false, false, false);
							    
								DB.collection("oauthtokens").findOne({
											'team_id': current_summary.team_id,
											}, function(e3, r3) {
												if (!e3) {
													if (r3) {
														slack = new SlackClient(r3.bot.bot_access_token);
								
														slack.chat.postMessage(channel_id, 
																obj.slack.text, {attachments: obj.slack.attachments}, 
																function(err, result) {
																	if (!err) {
																		if (!current_summary.ts) {
																			current_summary.ts = [];
																		}
																		current_summary.ts.push({channel: current_summary.channel_id, 
																			ts: result.ts});
																		
																		DB.collection("summary").updateOne(
																				{	
																					team_id: current_summary.team_id,
																					channel_id: current_summary.channel_id,
																					start_message: current_summary.start_message,
																				},
																				current_summary, 
																				{upsert: true},
																				function(err, res) {
																					if (err) {
																						console.log(err);
																					}
																				}
																		);
																	}
																});
													}}});
							}
						}
				});
			
		}
	});
}

function end_existing_summary(current_summary) {
	DB.collection("oauthtokens").findOne({
		'team_id': current_summary.team_id,
		}, function(e3, r3) {
			if (!e3) {
				if (r3) {
					slack = new SlackClient(r3.access_token);
					if (current_summary.channel_id.startsWith('C')) {
						slack.channels.history(
							current_summary.channel_id,
							{oldest: current_summary.start_message, 
							 latest: current_summary.end_message,
							},
							function(err2, result2) {
								run_summaries(err2, result2, current_summary);
						});
					} else if (current_summary.channel_id.startsWith("G")) { 
						slack.groups.history(
							current_summary.channel_id,
							{oldest: current_summary.start_message, 
							 latest: current_summary.end_message,
							},
							function(err2, result2) {
								run_summaries(err2, result2, current_summary);
							});
					} else if (current_summary.channel_id.startsWith("D")) { 
						slack.im.history(
								current_summary.channel_id,
								{oldest: current_summary.start_message, 
								 latest: current_summary.end_message,
								},
								function(err2, result2) {
									run_summaries(err2, result2, current_summary);
						});
					}
				}
			}
		});
			
}

function run_summaries(err2, result2, current_summary) {
	if (!err2 && result2.messages.length != 0) {
		result2.messages.forEach(function(result) {
			var text = result.text;
			current_summary.message_count += 1;
			var words = text.split(' ');
			current_summary.word_count += words.length;
			
			if (!(result.user in current_summary.participants)) {
				current_summary.participants[result.user] = {
						words: words.length
				};
			} else {
				current_summary.participants[result.user].words += words.length;
			}
		});
		
		current_summary.reading_time = current_summary.word_count/275.0;
		
		var sorted_parts = [];
		for (var part in current_summary.participants) {
			if (part != 'undefined') {
				sorted_parts.push([part, current_summary.participants[part]]);
			}
		}
		sorted_parts.sort(function(a, b) {
			return a[1].words - b[1].words;
		});
		var len = sorted_parts.length;
		if (len > 0) {
			current_summary.top_participants = '<@' + sorted_parts[len-1][0] + '>';
			if (len > 1) {
				current_summary.top_participants += ', <@' + sorted_parts[len-2][0] + '>';
			}
			if (len > 2) {
				current_summary.top_participants += ', <@' + sorted_parts[len-3][0] + '>';
			}
		} else {
			current_summary.top_participants = '';
		}
		
		send_proactive_message(current_summary);
	}
}

function start_summary(session) {	
	return {
			"meet_start": new Date(session.message.timestamp),
			"meet_end": null,
			"type": session.message.address.channelId,
			"team_id": session.message.sourceEvent.SlackMessage.team,
			"channel_id": session.message.sourceEvent.SlackMessage.channel,
			"info": [],
			"action": [],
			"topic": [],
			"idea": [],
			"question": [],
			"answer": [],
			"decision": [],
			"tag": [],
			"message_count": 0,
			"word_count": 0,
			"participants": {},
			"start_message": session.message.sourceEvent.SlackMessage.ts,
			"end_message": null,
	};
}

function channel_to_address(channel, address) {
	var data = {'channel': channel,
			'address': address};
	DB.collection("channeladdress").update(
			{channel: channel},
			data, {upsert: true});
}

function update_current_summary(team_id, channel_id, current_summary) {
	current_summary.last_updated = new Date();
	DB.collection("currentsummary").updateOne(
			{team_id: team_id, channel_id: channel_id},
			current_summary,
			{upsert: true},
			function(err, res) {
				if (err) {
					console.log(err);
				}
			}
	);
}

function delete_current_summary(team_id, channel_id) {
	var data = {'team_id': team_id,
			'channel_id': channel_id};
	DB.collection("currentsummary").remove(data);
}

var bot = new builder.UniversalBot(connector, function (session) {
	
	try {
		
		session.message.channel_id = session.message.sourceEvent.SlackMessage.channel;
		session.message.message_id = session.message.sourceEvent.SlackMessage.ts;
		session.message.post_date = new Date(session.message.timestamp);
		
	channel_to_address(session.message.sourceEvent.SlackMessage.channel,
			session.message.address);
	
	var team_id = session.message.sourceEvent.SlackMessage.team; 
	var channel_id = session.message.sourceEvent.SlackMessage.channel;
	
	var text = session.message.text;
	
	DB.collection("currentsummary").findOne({team_id: team_id,
		channel_id: channel_id},
			function(err, result) {
				current_summary = result;
				
				var start_meeting = (text.indexOf('/~start') == 0) || (text.indexOf('~start') == 0) || (text.indexOf(':start:') >= 0);
				if (start_meeting) {
					start_meeting = 0;
				} else {
					start_meeting = -1;
				}
				var end_meeting = (text.indexOf('/~end') == 0) || (text.indexOf('~end') == 0) || (text.indexOf(':end:') >= 0);
				if (end_meeting) {
					end_meeting = 0;
				} else {
					end_meeting = -1;
				}
				
				if (start_meeting >= 0) {
					if (current_summary) {
						var new_text = 'Ended prior conversation :end:  :small_red_triangle::small_red_triangle::small_red_triangle::small_red_triangle::small_red_triangle:';
						var obj = end_meeting_dialog(new_text, new Date().valueOf());
						obj.response_type = "in_channel";
						obj = {'slack': obj};
						
						var msg = new builder.Message().address(session.message.address);
						msg.textLocale('en-US');
						msg.sourceEvent(obj);
						bot.send(msg);
						send_tilda_post(new_text, channel_id);
						
						current_summary.end_message = session.message.sourceEvent.SlackMessage.ts;
						current_summary.meet_end = new Date(session.message.timestamp);
						end_existing_summary(current_summary);
						
						delete_current_summary(team_id, channel_id);
					}
					current_summary = start_summary(session);
					
					if (text.indexOf('/~start') < 0 || text.indexOf(':start:') >= 0) {
						var obj2 = post_instructions(false, 'Started a conversation :start:  :small_red_triangle_down::small_red_triangle_down::small_red_triangle_down::small_red_triangle_down::small_red_triangle_down:', '');
						obj2.response_type = "in_channel";
						obj2 = {'slack': obj2};
						var msg2 = new builder.Message().address(session.message.address);
						msg2.textLocale('en-US');
						msg2.sourceEvent(obj2);
						bot.send(msg2);
						send_tilda_post(obj2.slack.text, channel_id);
					}
					update_current_summary(team_id, channel_id, current_summary);
					
				} else if (end_meeting >= 0) {
					if (current_summary) {
						current_summary.end_message = session.message.sourceEvent.SlackMessage.ts;
						current_summary.meet_end = new Date(session.message.timestamp);
						end_existing_summary(current_summary);
						
						if (text.indexOf('/~end') < 0 || text.indexOf(':end:') >= 0) {
							var text2 = 'Ended conversation :end:  :small_red_triangle::small_red_triangle::small_red_triangle::small_red_triangle::small_red_triangle:';
							var obj3 = end_meeting_dialog(text2, new Date().valueOf());
							obj3.response_type = "in_channel";
							obj3 = {'slack': obj3};
							var msg3 = new builder.Message().address(session.message.address);
							msg3.textLocale('en-US');
							msg3.sourceEvent(obj3);
							bot.send(msg3);
							send_tilda_post(text2, channel_id);
						}
						delete_current_summary(team_id, channel_id);
					}
				}
				
				if (start_meeting < 0 && end_meeting < 0) {
					var info = (text.indexOf('~addinfo') == 0) || (text.indexOf('/~addinfo') == 0);
					if (info) {
						info = 0;
					} else {
						info = -1;
					}
					var action = (text.indexOf('~addaction') == 0) || (text.indexOf('/~addaction') == 0);
					if (action) {
						action = 0;
					} else {
						action = -1;
					}
					var topic = (text.indexOf('~addtopic') == 0) || (text.indexOf('/~addtopic') == 0);
					if (topic) {
						topic = 0;
					} else {
						topic = -1;
					}
					var idea = (text.indexOf('~addidea') == 0) || (text.indexOf('/~addidea') == 0);
					if (idea) {
						idea = 0;
					} else {
						idea = -1;
					}
					var question = (text.indexOf('~addquestion') == 0) || (text.indexOf('/~addquestion') == 0);
					if (question) {
						question = 0;
					} else {
						question = -1;
					}
					var answer = (text.indexOf('~addanswer') == 0) || (text.indexOf('/~addanswer') == 0);
					if (answer) {
						answer = 0;
					} else {
						answer = -1;
					}
					var decision = (text.indexOf('~adddecision') == 0) || (text.indexOf('/~adddecision') == 0);
					if (decision) {
						decision = 0;
					} else {
						decision = -1;
					}
					var tag = (text.indexOf('~addtag') == 0) || (text.indexOf('/~addtag') == 0);
					if (tag) {
						tag = 0;
					} else {
						tag = -1;
					}
					
					var info2 = (text.indexOf(':information_source:') >= 0) || (text.indexOf(':info:') >= 0);
					if (info2) {
						info2 = 0;
					} else {
						info2 = -1;
					}
					var action2 = (text.indexOf(':boom:') >= 0) || (text.indexOf(':action:') >= 0);
					if (action2) {
						action2 = 0;
					} else {
						action2 = -1;
					}
					var topic2 = (text.indexOf(':top:') >= 0) || (text.indexOf(':topic:') >= 0);
					if (topic2) {
						topic2 = 0;
					} else {
						topic2 = -1;
					}
					var idea2 = (text.indexOf(':bulb:') >= 0) || (text.indexOf(':idea:') >= 0);
					if (idea2) {
						idea2 = 0;
					} else {
						idea2 = -1;
					}
					var question2 = text.indexOf(':question:');
					var answer2 = (text.indexOf(':exclamation:') >= 0) || (text.indexOf(':answer:') >= 0);
					if (answer2) {
						answer2 = 0;
					} else {
						answer2 = -1;
					}
					var decision2 = text.indexOf(':decision:');
		
					if (info >= 0 || action >= 0 || topic >= 0 || idea >= 0 || 
							question >= 0 || answer >= 0 || decision >= 0 || tag >= 0 ||
							info2 >= 0 || action2 >= 0 || topic2 >= 0 || idea2 >= 0 || 
							question2 >= 0 || answer2 >= 0 || decision2 >= 0) {
						if (!current_summary) {
							current_summary = start_summary(session);
							var obj4 = post_instructions(false, 'Started a conversation :start:  :small_red_triangle_down::small_red_triangle_down::small_red_triangle_down::small_red_triangle_down::small_red_triangle_down:', '');
							obj4.response_type = "in_channel";
							obj4 = {'slack': obj4};
							var msg4 = new builder.Message().address(session.message.address);
							msg4.textLocale('en-US');
							msg4.sourceEvent(obj4);
							bot.send(msg4);
							send_tilda_post(obj4.slack.text, channel_id);
						}
			
						if (info >= 0 || info2 >= 0) {
							extract_text_command(session, '~addinfo', 'info', current_summary, 'information_source');
						} else if (action >= 0 || action2 >= 0) {
							extract_text_command(session, '~addaction', 'action',  current_summary, 'boom');
						} else if (topic >= 0 || topic2 >= 0) {
							extract_text_command(session, '~addtopic', 'topic',  current_summary, 'top');
						} else if (idea >= 0 || idea2 >= 0) {
							extract_text_command(session, '~addidea', 'idea',  current_summary, 'bulb');
						} else if (question >= 0 || question2 >= 0) {
							extract_text_command(session, '~addquestion', 'question',  current_summary, 'question');
						} else if (answer >= 0 || answer2 >= 0) {
							extract_text_command(session, '~addanswer', 'answer',  current_summary, 'exclamation');
						} else if (decision >= 0 || decision2 >= 0) {
							extract_text_command(session, '~adddecision', 'decision',  current_summary, 'decision');
						} else if (tag >= 0) {
							extract_text_command(session, '~addtag', 'tag',  current_summary, null);
						}
						
						update_current_summary(team_id, channel_id, current_summary);
					} else {
						if (!current_summary) {
							var lower_text = text.toLowerCase();
							var possible_idea = ["great idea", "good idea", "nice idea", "i have an idea", "my idea", 'i have a proposal',
								'great suggestion', 'good suggestion', 'nice suggestion','i have a suggestion'];
							for (var i=0;i<possible_idea.length;i++) {
								if (lower_text.indexOf(possible_idea[i]) >= 0) {
									var suggest_text = "_Was there an important idea posed? Make a note of it with :idea:_";
									post_to_channel(null, channel_id, suggest_text, null);
								}
							}
							var possible_decision = ["let's agree to", "let's decide to", "we've decided", "the decision is to", "agreed"];
							for (var i=0;i<possible_decision.length;i++) {
								if (lower_text.indexOf(possible_decision[i]) >= 0) {
									var suggest_text = "_Was there an important decision made? Make a note of it with :decision:_";
									post_to_channel(null, channel_id, suggest_text, null);
								}
							}
							var possible_action = ["can somebody", "don't forget to", "reminder to", "remember to", "reminder that you", "why don't you"];
							for (var i=0;i<possible_action.length;i++) {
								if (lower_text.indexOf(possible_action[i]) >= 0) {
									var suggest_text = "_Was there an important action item made? Make a note of it with :action:_";
									post_to_channel(null, channel_id, suggest_text, null);
								}
							}
							var possible_info = ["announcement", "fyi"];
							for (var i=0;i<possible_info.length;i++) {
								if (lower_text.indexOf(possible_info[i]) >= 0) {
									var suggest_text = "_Was there an important info item made? Make a note of it with :info:_";
									post_to_channel(null, channel_id, suggest_text, null);
								}
							}
							var possible_ques = ["can someone help me", "i'm having a problem with", "anyone know",
								"i can't figure out", "i'm having trouble with", "how do i", "can i have some help", "i need help"];
							for (var i=0;i<possible_ques.length;i++) {
								if (lower_text.indexOf(possible_ques[i]) >= 0) {
									var suggest_text = "_Was there an important question asked? Make a note of it with :question:_";
									post_to_channel(null, channel_id, suggest_text, null);
								}
							}
							
						}
					}
					
					
					
				}
				
				session.message.text = '';
				session.message.sourceEvent.SlackMessage.text = '';
				
				DB.collection("session").insertOne(session.message, function(err, res) {
					if (err) {
						console.log(err);
					}
				});
				
		}
	);
	
	} catch (err) {
		session.send(err.message);
	}
	
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
