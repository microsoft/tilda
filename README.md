
# Contributing

This project welcomes contributions and suggestions.  Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit https://cla.microsoft.com.

When you submit a pull request, a CLA-bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., label, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

# Installation Instructions

## Setting up Slack API

1. To run your own version of Tilda, you'll need to get an account on api.slack.com. Once you have done so, create a new Slack App and select a Slack Workspace that you will be using for development. Once you have done so, grab your Slack client ID and secret for below.


## Setting up node server

3. To run Tilda, you need to either have a hosted server you can run node.js on or use [ngrok to test locally](https://api.slack.com/tutorials/tunneling-with-ngrok).

4. Clone this Github repository into your server space or locally, depending on the above.


## Setting up MongoDB




## Set up Slack commands


## Run Tilda

5. Add the following to your `.env` file:

```
MONGO_DB=<DB CONNECTION STRING>
SLACK_OAUTH_ACCESS_TOKEN=<SLACK ACCESS TOKEN>
BOT_USER_OAUTH_ACCESS_TOKEN=<BOT ACCESS TOKEN>
SLACK_CLIENT_ID=<SLACK CLIENT ID>
SLACK_CLIENT_SECRET=<SLACK CLIENT SECRET>
```


