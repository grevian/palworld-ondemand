import * as path from 'path';
import {
    Arn,
    ArnFormat,
    aws_ec2 as ec2,
    aws_ecs as ecs,
    aws_efs as efs,
    aws_iam as iam,
    aws_logs as logs,
    aws_logs_destinations as logDestinations,
    aws_sns as sns, CfnOutput,
    RemovalPolicy,
    Stack,
    StackProps,
} from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import {Construct} from 'constructs';
import {constants} from './constants';
import {StackConfig} from './types';
import {getPalworldServerConfig} from './util';
import {WatchdogContainerConstruct} from "./watchdog-container";
import {Domain} from "./domain";
import {Protocol} from "aws-cdk-lib/aws-ecs";

interface PalworldStackProps extends StackProps {
  config: Readonly<StackConfig>;
}

export class PalworldStack extends Stack {
    public readonly snsNotificationTopic: sns.Topic;
    public readonly launcherLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: PalworldStackProps) {
    super(scope, id, props);

    const { config } = props;

    const palworldDomain = new Domain(this, id, config.domainName, config.subdomainPart);

    const vpc = config.vpcId
      ? ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: config.vpcId })
      : new ec2.Vpc(this, 'Vpc', {
          maxAzs: 3,
          natGateways: 0,
        });

    // Create a lambda function to spin the server up and down on demand
      const launcherLambda = new lambda.Function(this, 'LauncherLambda', {
          code: lambda.Code.fromAsset(path.resolve(__dirname, '../../lambda')),
          handler: 'lambda_function.lambda_handler',
          runtime: lambda.Runtime.PYTHON_3_11,
          environment: {
              REGION: config.serverRegion,
              CLUSTER: constants.CLUSTER_NAME,
              SERVICE: constants.SERVICE_NAME,
          },
          logRetention: logs.RetentionDays.THREE_DAYS, // TODO: parameterize
      });
      const fnURL = launcherLambda.addFunctionUrl({
          authType: lambda.FunctionUrlAuthType.NONE
      })
      new CfnOutput(this, 'TheUrl', {
          value: fnURL.url,
      });

      this.launcherLambda = launcherLambda

      /**
       * Give cloudwatch permission to invoke our lambda when our subscription filter
       * picks up DNS queries.
       */
      launcherLambda.addPermission('CWPermission', {
          principal: new iam.ServicePrincipal(
              `logs.${constants.DOMAIN_STACK_REGION}.amazonaws.com`
          ),
          action: 'lambda:InvokeFunction',
          sourceAccount: this.account,
          sourceArn: palworldDomain.dnsLogGroup.logGroupArn,
      });

    const fileSystem = new efs.FileSystem(this, 'FileSystem', {
      vpc,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const accessPoint = new efs.AccessPoint(this, 'AccessPoint', {
      fileSystem,
      path: '/palworld',
      posixUser: {
        uid: '1000',
        gid: '1000',
      },
      createAcl: {
        ownerGid: '1000',
        ownerUid: '1000',
        permissions: '0755',
      },
    });

    const efsReadWriteDataPolicy = new iam.Policy(this, 'DataRWPolicy', {
      statements: [
        new iam.PolicyStatement({
          sid: 'AllowReadWriteOnEFS',
          effect: iam.Effect.ALLOW,
          actions: [
            'elasticfilesystem:ClientMount',
            'elasticfilesystem:ClientWrite',
            'elasticfilesystem:DescribeFileSystems',
          ],
          resources: [fileSystem.fileSystemArn],
          conditions: {
            StringEquals: {
              'elasticfilesystem:AccessPointArn': accessPoint.accessPointArn,
            },
          },
        }),
      ],
    });

    const ecsTaskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Palworld ECS task role',
    });

    efsReadWriteDataPolicy.attachToRole(ecsTaskRole);

    const cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: constants.CLUSTER_NAME,
      vpc,
      containerInsights: true, // TODO: Add config for container insights
      enableFargateCapacityProviders: true,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      'TaskDefinition',
      {
        taskRole: ecsTaskRole,
        memoryLimitMiB: config.taskMemory,
        cpu: config.taskCpu,
        volumes: [
          {
            name: constants.ECS_VOLUME_NAME,
            efsVolumeConfiguration: {
              fileSystemId: fileSystem.fileSystemId,
              transitEncryption: 'ENABLED',
              authorizationConfig: {
                accessPointId: accessPoint.accessPointId,
                iam: 'ENABLED',
              },
            },
          },
        ],
      }
    );

    const palworldServerConfig = getPalworldServerConfig();

    const palworldServerContainer = new ecs.ContainerDefinition(
      this,
      'ServerContainer',
      {
        containerName: constants.MC_SERVER_CONTAINER_NAME,
        image: ecs.ContainerImage.fromRegistry(palworldServerConfig.image),
        portMappings: [
          {
            containerPort: palworldServerConfig.queryPort,
            hostPort: palworldServerConfig.queryPort,
            protocol: palworldServerConfig.protocol,
          },
          {
            containerPort: palworldServerConfig.gamePort,
            hostPort: palworldServerConfig.gamePort,
            protocol: palworldServerConfig.protocol,
          },
          {
            containerPort: palworldServerConfig.rconPort,
            hostPort: palworldServerConfig.rconPort,
            protocol: Protocol.TCP,
          },
        ],
        essential: false,
        taskDefinition,
        environment: {
          ADMIN_PASSWORD: config.palworld.adminPassword,
          SERVER_PASSWORD: config.palworld.serverPassword,
          DISCORD_WEBHOOK_URL: config.discord.webhookURL,
          MULTITHREADING: String(config.multithreaded),
            SERVER_NAME: "Beebworld",
            SERVER_DESCRIPTION: "Not Boobworld",
            EXP_RATE: "10.0",
            PLAYER_AUTO_HP_REGEN_RATE: "2.0",
            PAL_CAPTURE_RATE: "2.0",
        },
        logging: new ecs.AwsLogDriver({
              logRetention: logs.RetentionDays.ONE_MONTH,
              streamPrefix: constants.MC_SERVER_CONTAINER_NAME,
            })
      }
    );

    palworldServerContainer.addMountPoints({
      containerPath: '/palworld/Pal/Saved',
      sourceVolume: constants.ECS_VOLUME_NAME,
      readOnly: false,
    });

    const serviceSecurityGroup = new ec2.SecurityGroup(
      this,
      'ServiceSecurityGroup',
      {
        vpc,
        description: 'Security group for Palworld on-demand',
      }
    );

    serviceSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.udp(palworldServerConfig.queryPort),
      'Allow inbound traffic to Query Port'
    );
    serviceSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.udp(palworldServerConfig.gamePort),
      'Allow inbound traffic to Game Port'
    );
    serviceSecurityGroup.addIngressRule(
        ec2.Peer.anyIpv4(),
        ec2.Port.tcp(palworldServerConfig.rconPort),
        'Allow inbound traffic to RCON Port'
    );

    const palworldServerService = new ecs.FargateService(
      this,
      'FargateService',
      {
        cluster,
        capacityProviderStrategies: [
          {
            capacityProvider: config.useFargateSpot
              ? 'FARGATE_SPOT'
              : 'FARGATE',
            weight: 1,
            base: 1,
          },
        ],
        taskDefinition: taskDefinition,
        platformVersion: ecs.FargatePlatformVersion.LATEST,
        serviceName: constants.SERVICE_NAME,
        desiredCount: 0,
        assignPublicIp: true,
        securityGroups: [serviceSecurityGroup],
        enableExecuteCommand: true,
      }
    );

    /* Allow access to EFS from Fargate service security group */
    fileSystem.connections.allowDefaultPortFrom(
      palworldServerService.connections
    );

    // Define SNS Topic
    const snsTopic = new sns.Topic(this, 'PalworldServerSnsTopic');
    snsTopic.grantPublish(ecsTaskRole);
    this.snsNotificationTopic = snsTopic;

    const watchdogContainerConstruct = new WatchdogContainerConstruct(this, 'palworld-watchdog-image', config.palworld.adminPassword)

    const watchdogContainer = new ecs.ContainerDefinition(
      this,
      'WatchDogContainer',
      {
        containerName: constants.WATCHDOG_SERVER_CONTAINER_NAME,
        image: ecs.ContainerImage.fromDockerImageAsset(watchdogContainerConstruct.containerImage),
        essential: true,
        taskDefinition: taskDefinition,
        environment: {
          CLUSTER: constants.CLUSTER_NAME,
          SERVICE: constants.SERVICE_NAME,
          DNSZONE: palworldDomain.domain.hostedZoneId,
          SERVERNAME: `${config.subdomainPart}.${config.domainName}`,
          SNSTOPIC: snsTopic.topicArn,
          TWILIOFROM: config.twilio.phoneFrom,
          TWILIOTO: config.twilio.phoneTo,
          TWILIOAID: config.twilio.accountId,
          TWILIOAUTH: config.twilio.authCode,
          STARTUPMIN: config.startupMinutes,
          SHUTDOWNMIN: config.shutdownMinutes,
          RCONPASSWORD: config.palworld.adminPassword,
        },
        logging: new ecs.AwsLogDriver({
              logRetention: logs.RetentionDays.ONE_MONTH,
              streamPrefix: constants.WATCHDOG_SERVER_CONTAINER_NAME,
            })
      }
    );

    const serviceControlPolicy = new iam.Policy(this, 'ServiceControlPolicy', {
      statements: [
        new iam.PolicyStatement({
          sid: 'AllowAllOnServiceAndTask',
          effect: iam.Effect.ALLOW,
          actions: ['ecs:*'],
          resources: [
            palworldServerService.serviceArn,
            /* arn:aws:ecs:<region>:<account_number>:task/palworld/* */
            Arn.format(
              {
                service: 'ecs',
                resource: 'task',
                resourceName: `${constants.CLUSTER_NAME}/*`,
                arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
              },
              this
            ),
          ],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['ec2:DescribeNetworkInterfaces'],
          resources: ['*'],
        }),
      ],
    });

    serviceControlPolicy.attachToRole(ecsTaskRole);

    /**
     * Add service control policy to the launcher lambda
     */
    serviceControlPolicy.attachToRole(launcherLambda.role!);

    /**
     * This policy gives permission to our ECS task to update the A record
     * associated with our minecraft server. Retrieve the hosted zone identifier
     * from Route 53 and place it in the Resource line within this policy.
     */
    const iamRoute53Policy = new iam.Policy(this, 'IamRoute53Policy', {
      statements: [
        new iam.PolicyStatement({
          sid: 'AllowEditRecordSets',
          effect: iam.Effect.ALLOW,
          actions: [
            'route53:GetHostedZone',
            'route53:ChangeResourceRecordSets',
            'route53:ListResourceRecordSets',
          ],
          resources: [`arn:aws:route53:::hostedzone/${palworldDomain.domain.hostedZoneId}`],
        }),
      ],
    });
    iamRoute53Policy.attachToRole(ecsTaskRole);


    palworldDomain.dnsLogGroup.addSubscriptionFilter('SubscriptionFilter', {
        destination: new logDestinations.LambdaDestination(launcherLambda),
        filterPattern: logs.FilterPattern.anyTerm(palworldDomain.domain.zoneName),
    });

  }
}
