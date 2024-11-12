import { DynamoDB, S3 } from 'aws-sdk';
const s3 = new S3();

const dynamoDb = new DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME!;
const BUCKET_NAME = process.env.BUCKET_NAME!;
const BASE_PLAYER_URL = `http://${BUCKET_NAME}.s3.eu-central-1.amazonaws.com/player-audio.html`;

const playerHtml = (url: string) => {
  return `<audio controls><source src="${encodeURIComponent(url)}" type="audio/mpeg">Your browser does not support the audio element.</audio>`
}

const playerIFrame = (url: string) => {
  return `${BASE_PLAYER_URL}?audioUrl=${encodeURIComponent(url)}`;
}

exports.handler = async (event: any) => {
  try {
    const audioId = event.queryStringParameters?.audioId;

    if (!audioId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'audioId is required' }),
      };
    }

    const result = await dynamoDb.get({
      TableName: TABLE_NAME,
      Key: { audioId },
    }).promise();

    if (!result.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Job not found' }),
      };
    }

    if (result.Item.status === 'COMPLETED') {
      return {
        statusCode: 200,
        body: JSON.stringify({
          audioId: result.Item.audioId,
          status: result.Item.status,
          audioUrl: result.Item.audioUrl,
          playerHtml: playerHtml(result.Item.audioUrl),
          playerIFrame: playerIFrame(result.Item.audioUrl),
         }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        audioId: result.Item.audioId,
        status: result.Item.status,
        message: 'Processing is still in progress',
      }),
    };
  } catch (error) {
    console.error('Error fetching job status:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'An error occurred while fetching job status' }),
    };
  }
};
