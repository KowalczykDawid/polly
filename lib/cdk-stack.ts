import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3Deployment from 'aws-cdk-lib/aws-s3-deployment';
import * as sqs from 'aws-cdk-lib/aws-sqs';

import { Construct } from 'constructs';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const audioBucket = new s3.Bucket(this, 'AudioBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    audioBucket.addCorsRule({
      allowedMethods: [s3.HttpMethods.GET],
      allowedOrigins: ['*'],
      allowedHeaders: ['*'],
      exposedHeaders: ['ETag'],
    });

    new s3Deployment.BucketDeployment(this, 'DeployAudioPlayerHTML', {
      sources: [s3Deployment.Source.asset(path.join(__dirname, '../player'))],
      destinationBucket: audioBucket,
    });

    const audioTable = new dynamodb.Table(this, 'AudioTable', {
      partitionKey: { name: 'audioId', type: dynamodb.AttributeType.STRING }, // audioId to hash tekstu
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const userTable = new dynamodb.Table(this, 'UserTable', {
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const queue = new sqs.Queue(this, 'TextToSpeechQueue', {
      visibilityTimeout: cdk.Duration.minutes(15),
    });

    const enqueueLambda = new NodejsFunction(this, 'EnqueueLambda', {
      entry: path.join(__dirname, '../lambda/enqueue.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_16_X,
      environment: {
        BUCKET_NAME: audioBucket.bucketName,
        QUEUE_URL: queue.queueUrl,
        TABLE_NAME: audioTable.tableName,
      },
      bundling: {
        externalModules: ['aws-sdk'],
      },
    });
    queue.grantSendMessages(enqueueLambda);
    audioTable.grantReadWriteData(enqueueLambda);

    const processTextLambda = new NodejsFunction(this, 'ProcessTextLambda', {
      entry: path.join(__dirname, '../lambda/processText.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_16_X,
      environment: {
        BUCKET_NAME: audioBucket.bucketName,
        TABLE_NAME: audioTable.tableName,
      },
      timeout: cdk.Duration.minutes(15),
      bundling: {
        externalModules: ['aws-sdk'],
      },
    });

    audioBucket.grantWrite(processTextLambda);
    audioTable.grantReadWriteData(processTextLambda);
    queue.grantConsumeMessages(processTextLambda);

    processTextLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['polly:SynthesizeSpeech'],
      resources: ['*'],
    }));

    processTextLambda.addEventSource(new lambdaEventSources.SqsEventSource(queue));

    const api = new apigateway.RestApi(this, 'TextToSpeechApi', {
      restApiName: 'Text to Speech Service',
      description: 'API do konwersji tekstu na dźwięk.',
    });

    const authorizerLambda = new NodejsFunction(this, 'AuthorizerLambda', {
      entry: path.join(__dirname, '../lambda/auth.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_16_X,
      environment: {
        TABLE_NAME: userTable.tableName,
      },
      bundling: {
        externalModules: ['aws-sdk'],
      },
    });
    userTable.grantReadWriteData(authorizerLambda);

    const authorizer = new apigateway.TokenAuthorizer(this, 'ApiAuthorizer', {
      handler: authorizerLambda,
      identitySource: 'method.request.header.Authorization',
    });

    const textResource = api.root.addResource('text');
    textResource.addMethod('POST', new apigateway.LambdaIntegration(enqueueLambda, {
      proxy: true,
    }), {
      authorizer,
    });

    const statusLambda = new NodejsFunction(this, 'StatusLambda', {
      entry: path.join(__dirname, '../lambda/status.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_16_X,
      environment: {
        BUCKET_NAME: audioBucket.bucketName,
        TABLE_NAME: audioTable.tableName,
      },
      bundling: {
        externalModules: ['aws-sdk'],
      },
    });
    audioTable.grantReadData(statusLambda);

    const statusResource = api.root.addResource('status');
    statusResource.addMethod('GET', new apigateway.LambdaIntegration(statusLambda, {
      proxy: true,
    }), {
      authorizer,
    });
  }
}
