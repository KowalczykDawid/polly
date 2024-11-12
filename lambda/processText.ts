import * as crypto from 'crypto';

import { DynamoDB, Polly, S3 } from 'aws-sdk';

const dynamoDb = new DynamoDB.DocumentClient();
const polly = new Polly();
const s3 = new S3();

const BUCKET_NAME = process.env.BUCKET_NAME!;
const TABLE_NAME = process.env.TABLE_NAME!;

exports.handler = async (event: any) => {
  for (const record of event.Records) {
    try {
      const { jobId, text, audioId } = JSON.parse(record.body);

      const textChunks = splitText(text);
      const audioBuffers = [];
    
      for (const chunk of textChunks) {
        const audioStream = await polly.synthesizeSpeech({
          OutputFormat: 'mp3',
          Text: chunk,
          VoiceId: 'Ola',
          Engine: 'neural',
        }).promise();

        if (audioStream.AudioStream) {
          audioBuffers.push(audioStream.AudioStream);
        }
      }

      // Łączenie fragmentów audio w jeden bufor
      const completeAudioBuffer = Buffer.concat(audioBuffers);

      // Zapisanie pliku audio w S3
      const filePath = `audio/${audioId}/master.mp3`;
      await s3.putObject({
        Bucket: BUCKET_NAME,
        Key: filePath,
        Body: completeAudioBuffer,
        ContentType: 'audio/mpeg',
      }).promise();

      const audioUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/${filePath}`;

      await dynamoDb.put({
        TableName: TABLE_NAME,
        Item: {
          audioId,
          audioUrl,
          status: 'COMPLETED',
        },
      }).promise();

      console.log(`Successfully processed job ${jobId}`);
    } catch (error) {
      console.error('Error processing message from SQS:', error);
    }
  }
};

function splitText(text: string, maxLength = 3000): string[] {
  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = start + maxLength;

    if (end < text.length) {
      const lastSpace = text.lastIndexOf(' ', end);
      if (lastSpace > start) {
        end = lastSpace;
      }
    }

    chunks.push(text.slice(start, end));
    start = end + 1;
  }

  return chunks;
}
