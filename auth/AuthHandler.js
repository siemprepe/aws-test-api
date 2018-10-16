const serverless = require('serverless-http');
const bodyParser = require('body-parser');
const express = require('express')
const app = express()
const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs-then');
const util = require('util')

const USERS_TABLE = process.env.USERS_TABLE;

const IS_OFFLINE = process.env.IS_OFFLINE;
let dynamoDb;
if (IS_OFFLINE === 'true') {
  dynamoDb = new AWS.DynamoDB.DocumentClient({
    region: 'localhost',
    endpoint: 'http://localhost:8000'
  })
  console.log(dynamoDb);
} else {
  dynamoDb = new AWS.DynamoDB.DocumentClient();
};

app.use(bodyParser.json({ strict: false }));

app.post('/register', function(req, res){
  console.log("REGISTER: " + JSON.stringify(req.body))
  return register(req.body)
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

app.get('/testuser', function(req, res){
  let principal = req.context.authorizer.principalId
  let claims = req.context.authorizer.claims
  res.json({user: principal, claims: claims});
})

function signToken(user) {
  return jwt.sign({ id: user.userId,roles:user.roles }, process.env.JWT_SECRET, {
    expiresIn: 86400 // expires in 24 hours
  });
}

function register(body) {
  return checkIfInputIsValid(body) // validate input
    .then(() => (
      dynamoDb.get({
        TableName: USERS_TABLE,
        Key: {
          userId: body.userId,
        },
      }).promise()
    ))
    .then(user => {
      console.log("USERXXX1: " + util.inspect(user))
      return user.userId
        ? Promise.reject(new Error('User with that userId exists.'))
        : bcrypt.hash(body.password, 8) // hash the pass
    })
    .then(hash => {
      console.log("PASSHASH " + hash)
      dynamoDb.put({
        TableName: USERS_TABLE,
        Item: {
          userId: body.userId,
          name: body.name,
          email: body.email,
          password: hash
        },
        ReturnValues: 'ALL_OLD'
      }).promise()
    })
    .then(user => {
      console.log("USERXXXXX: " + util.inspect(user))
      //SIGNTOKEN is broken for register (need to pass user with roles)
      return { auth: true, token: signToken(body.userId) }
    })
}

function checkIfInputIsValid(body){
  if (
    !(body.password &&
      body.password.length >= 7)
  ) {
    return Promise.reject(new Error('Password error. Password needs to be longer than 8 characters.'));
  }

  if (
    !(body.userId &&
      body.userId.length > 5 &&
      typeof body.userId === 'string')
  ) return Promise.reject(new Error('UserId error. UserId needs to longer than 5 characters'));

  if (
    !(body.name &&
      body.name.length > 5 &&
      typeof body.name === 'string')
  ) return Promise.reject(new Error('Username error. Username needs to longer than 5 characters'));

  if (
    !(body.email &&
      typeof body.email === 'string')
  ) return Promise.reject(new Error('Email error. Email must have valid characters.'));
  return Promise.resolve();
}

module.exports.handler = serverless(app, {
  request: function(request, event, context) {
    request.context = event.requestContext;
  }
})
