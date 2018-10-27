const serverless = require('serverless-http');
const bodyParser = require('body-parser');
const express = require('express')
const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs-then');
const util = require('util')
const uuidv1 = require('uuid/v1')

const app = express()

const USERS_TABLE = process.env.USERS_TABLE;
const REGISTRATION_TABLE = process.env.REGISTRATION_TABLE;

const IS_OFFLINE = process.env.IS_OFFLINE;
let dynamoDb;
let ses;
if (IS_OFFLINE === 'true') {
  dynamoDb = new AWS.DynamoDB.DocumentClient({
    region: 'localhost',
    endpoint: 'http://localhost:8000'
  })
  console.log(dynamoDb);
  ses = new AWS.SES({endpoint: 'http://localhost:9001'})
  console.log(ses);
} else {
  dynamoDb = new AWS.DynamoDB.DocumentClient();
  ses = new AWS.SES({ apiVersion: "2010-12-01" });
};

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.use(bodyParser.json({ strict: false }));

app.post('/register', function(req, res){
  console.log("REGISTER: " + JSON.stringify(req.body))
  return register(req.body)
    .then(session => {
        res.json(session)
    })
    .catch(err =>
      res.status(err.statusCode || 500).json({ error: err.message })
    );
})

app.get('/register/activate/:token', function(req, res){
  console.log("ACTIVATE: " + JSON.stringify(req.params.token))
  return activateRegistration(req.params.token)
    .then(session =>
      res.json(session)
    )
    .catch(err =>
      res.status(err.statusCode || 500).json({ error: err.message })
    );
})

app.post('/login', function(req, res){
  console.log("LOGIN: " + JSON.stringify(req.body))
  return login(req.body)
    .then(session =>
      res.json(session)
    )
    .catch(err =>
      res.status(err.statusCode || 500).json({ error: err.message })
    );
})

function login(body) {
  var rootUser = {};
  return dynamoDb.get({
            TableName: USERS_TABLE,
            Key: {
              userId: body.userId,
            },
          }).promise()
    .then(user => {
      console.log("LOGINUSER: " + util.inspect(user))
      console.log("LOGINUSER: " + body.password)
      rootUser = user;
      return user.Item === undefined || !user.Item.userId
        ? Promise.reject(new Error('User not found'))
        : comparePassword(body.password, user.Item.password, user.Item)
    })
    .then(token => ({ auth: true,
                      token: token,
                      userId: rootUser.Item.userId,
                      name: rootUser.Item.name,
                      email: rootUser.Item.email,
                      roles: rootUser.Item.roles
                    })
        );
}

function comparePassword(inputPassword, userPassword, user) {
  console.log("comparing " + inputPassword + " - " + userPassword)
  return bcrypt.compare(inputPassword, userPassword)
    .then(passwordIsValid =>
      !passwordIsValid
        ? Promise.reject(new Error('The credentials do not match.'))
        : signToken(user)
    );
}

function signToken(user) {
  return jwt.sign({ id: user.userId,roles:user.roles }, process.env.JWT_SECRET, {
    expiresIn: 86400 // expires in 24 hours
  });
}

function register(body){
  const {userId, email, password, name} = body;
  let rootToken;
  return checkIfInputIsValid(body)
  .then(() => (
      dynamoDb.get({
        TableName: USERS_TABLE,
        Key: {
          userId: body.userId,
        },
      }).promise()
    ))
  .then(user => {
    console.log(`Ùser found: ${util.inspect(user)}`);
    if(user === undefined || user === null || !user.userId){
      return bcrypt.hash(body.password, 8);
    }else{
      return Promise.reject(new Error('UserId already taken'))
    }
  })
  .then(hash => {
    const {token,expiration} = buildRegistration();
    rootToken = token;
    let params = {
      TableName: REGISTRATION_TABLE,
      Item: {
        userId: userId,
        name: name,
        email: email,
        password: hash,
        token: token,
        expiration: expiration
      },
      ReturnValues: 'ALL_OLD'
    };
    return dynamoDb.put(params).promise()
  })
  .then(registration => {
    return sendEmail(userId,email, rootToken)
  })
  .then(msg => {
    return { success: true}
  })
}

function buildRegistration(){
  return {token: uuidv1(), expiration: new Date().getTime() + 24 * 60 * 60 * 1000};
}

function sendEmail(userId, email, token) {
  const deploy_url = process.env.DEPLOY_URL;
  var params = {
    Destination: {
      CcAddresses: ['cgibeparking@gmail.com'],
      ToAddresses: [email]
    },
    Message: {
      Body: {
        // Html: {
        //  Charset: "UTF-8",
        //  Data: "HTML_FORMAT_BODY"
        // },
        Text: {
         Charset: "UTF-8",
         Data: `Hello ${userId}, activate here ${deploy_url}/activation/${token}`
        }
       },
       Subject: {
        Charset: 'UTF-8',
        Data: 'Test email'
       }
      },
    Source: 'cgibeparking@gmail.com',
    ReplyToAddresses: ['cgibeparking@gmail.com'],
    ReturnPath: 'cgibeparking@gmail.com'
  };
  return ses.sendEmail(params).promise();
}

function activateRegistration(token){
  console.log(`Looking up reg ${token}`)
  var rootUser;
  return dynamoDb.get({
            TableName: REGISTRATION_TABLE,
            Key: {
              token: token
            }
          }).promise()
          .then(registration => {
            console.log("registration: " + util.inspect(registration))
            if(registration === undefined || registration === null || !registration.Item){
              return Promise.reject(new Error('Activation Token not valid'))
            }else{
              return checkRegistration(registration)
            }
          })
          .then(registration => {
            let item = {
              userId: registration.Item.userId,
              name: registration.Item.name,
              email: registration.Item.email,
              password: registration.Item.password,
              roles: 'MEMBER'
            };
            let params = {
              TableName: USERS_TABLE,
              Item: item,
              ReturnValues: 'ALL_OLD'
            }
            rootUser = item;
            return dynamoDb.put(params).promise();
          })
          .then(() => {
            let params = {
                      TableName: REGISTRATION_TABLE,
                      Key: {
                        token: token
                      }
                    }
            return dynamoDb.delete(params).promise();
          })
            .then(user => {
              console.log("USER CREATED: " + util.inspect(rootUser))
              return { auth: true,
                        token: signToken(user),
                        userId: rootUser.userId,
                        name: rootUser.name,
                        email: rootUser.email,
                        roles: rootUser.roles
                      }
            })
}

function checkRegistration(registration){
  const { expiration } = registration;
  let exp = new Date(expiration);
  let now = new Date();
  if(exp.getTime() > now.getTime()){
    console.log("TOKEN HAS EXPIRED");
    return Promise.reject(new Error('Activation Token has expired'))
  }else{
    console.log("TOKEN IS VALID")
    return registration;
  }
}

function checkIfInputIsValid(body){
  const {userId, email, password} = body;
  if (
    !(password &&
      password.length >= 7)
  ) {
    return Promise.reject(new Error('Password needs to be longer than 8 characters'));
  }

  if (
    !(userId &&
      userId.length > 5 &&
      typeof userId === 'string')
  ) return Promise.reject(new Error('Username needs to longer than 5 characters'));

  if (
    !(email &&
      typeof email === 'string' &&
      email.includes('@cgi.com'))
  ) return Promise.reject(new Error('Email is not valid'));
  return Promise.resolve();
}

module.exports.handler = serverless(app, {
  request: function(request, event, context) {
    request.context = event.requestContext;
  }
})
