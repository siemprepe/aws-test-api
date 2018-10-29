# aws-test-api
This is a test project for me to play around with writing AWS Lambdas and storing data in dynamoDb

## Technologies used
Node-js, Serverless framework, DynamoDB

## Instructions
d

## Lessons learned
### Custom authorizer
Attributes added onto context of policy can not be of type array or object.
This will result in a obscure error returning a 500 with {message: null}.
Spent quite a lot of time in figuring this out.
```
//NOT ALLOWED
authResponse.context = {"roles":["role","role"]};

//ALLOWED
authResponse.context = {"roles":"role;role"};
```
