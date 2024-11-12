import { DynamoDB } from 'aws-sdk';

const dynamoDb = new DynamoDB.DocumentClient();
const TABLE_NAME = process.env.TABLE_NAME!;

exports.handler = async (event: any) => {
  const token = event.authorizationToken.replace(`Bearer `, ``);

  const user = await dynamoDb.get({ TableName: TABLE_NAME, Key: { userId: token } }).promise();
  if (!user.Item) {
    throw new Error('Unauthorized');
  }

  const apiArnParts = event.methodArn.split('/');
  const resourceArn = `${apiArnParts[0]}/${apiArnParts[1]}/*`;

  return {
    principalId: token,
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: 'Allow',
          Resource: resourceArn
        },
      ],
    },
    context: {
        userId: user.Item.userId,
      }
  };
};
