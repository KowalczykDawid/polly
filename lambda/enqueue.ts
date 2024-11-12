import * as crypto from 'crypto';

import { DynamoDB, SQS } from 'aws-sdk';

const dynamoDb = new DynamoDB.DocumentClient();
const sqs = new SQS();

const QUEUE_URL = process.env.QUEUE_URL!;
const TABLE_NAME = process.env.TABLE_NAME!;

exports.handler = async (event: any) => {
  try {
    const { text } = JSON.parse(event.body);
    if (!text) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Text is required' }),
      };
    }

    const audioId = crypto.createHash('sha256').update(text).digest('hex');

    const existingItem = await dynamoDb.get({
      TableName: TABLE_NAME,
      Key: { audioId },
    }).promise();

    if (existingItem.Item) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Audio already exists for this text',
          audioId,
          status: existingItem.Item.status,
        }),
      };
    }
    
    const sqsMessage = {
      QueueUrl: QUEUE_URL,
      MessageBody: JSON.stringify({
        text,
        audioId,
      }),
    };

    await dynamoDb.put({
        TableName: TABLE_NAME,
        Item: {
          audioId,
          audioUrl: "",
          status: 'STARTED',
        },
      }).promise();

    await sqs.sendMessage(sqsMessage).promise();

    return {
      statusCode: 202,
      body: JSON.stringify({
        message: 'Text received and processing started',
        audioId,
      }),
    };
  } catch (error) {
    console.error('Error in enqueue lambda:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'An error occurred while processing the request' }),
    };
  }
};
