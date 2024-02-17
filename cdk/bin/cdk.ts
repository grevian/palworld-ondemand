#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PalworldStack } from '../lib/palworld-stack';
import { Domain } from '../lib/domain';
import { constants } from '../lib/constants';
import { resolveConfig } from '../lib/config';
import {ChatbotStack} from "../lib/chat-integration";
import * as domain from "domain";

const app = new cdk.App();

const config = resolveConfig();

if (!config.domainName) {
  throw new Error('Missing required `DOMAIN_NAME` in .env file, please rename\
    `.env.sample` to `.env` and add your domain name.');
}

const palworldStack = new PalworldStack(app, 'palworld-server-stack', {
  env: {
    region: config.serverRegion,
    /* Account must be specified to allow for VPC lookup */
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  tags: {
    Application: 'palworld-server'
  },
  config,
});

// const chatbotStack = new ChatbotStack(app, 'palworld-bot-stack', {
//   env: {
//     region: config.serverRegion,
//     /* Account must be specified to allow for VPC lookup */
//     account: process.env.CDK_DEFAULT_ACCOUNT,
//   },
//   config,
//   launcherLambda: palworldStack.launcherLambda,
//   snsNotificationTopic: palworldStack.snsNotificationTopic
// })
//
// chatbotStack.addDependency(palworldStack);
