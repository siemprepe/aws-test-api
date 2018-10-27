const serverless = require('serverless-http');
const bodyParser = require('body-parser');
const express = require('express');
const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');
const util = require('util');
const app = express();

const PARKINGS_TABLE = process.env.PARKINGS_TABLE;

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

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.use(bodyParser.json({ strict: false }));

app.get('/parkings', function(req, res){
  console.log("GET PARKINGS")
  return getAllParkings(req.body)
    .then(session =>
      res.json(session)
    )
    .catch(err =>{
      console.log("GET PARKINGS FAILED: " + util.inspect(err));
      res.status(err.statusCode || 500).json({ error: err.message })
    }

    );
})

function getAllParkings(body) {
  return dynamoDb.scan({
            TableName: PARKINGS_TABLE,
          }).promise()
    .then(parkings => parkings.Items);
}

//Temporary role check on route. Better to use middleware component.
function checkRole(roles, expectedRole){
  return roles !== null ? roles.split(';').find(role => role === expectedRole) : false
}

app.post('/parkings', function(req,res){
  console.log("Add Parking: " + JSON.stringify(req.body))
  if(checkRole(req.context.authorizer.roles, 'ADMIN')){
    return addParking(req.body)
      .then(session =>
        res.json(session)
      )
      .catch(err =>
        res.status(err.statusCode || 500).json({ error: err.message })
      );
  }else{
    res.status(403).json({ error: 'Unauthorized' })
  }

})
function addParking(body) {
  return checkIfInputIsValid(body) // validate input
    .then(() => (
      dynamoDb.get({
        TableName: PARKINGS_TABLE,
        Key: {
          parkingId: body.parkingId
        },
      }).promise()
    ))
    .then(parking => {
      console.log("PARKINGFOUND: " + util.inspect(parking))
      return parking && parking.Item && parking.Item.parkingId
        ? Promise.reject(new Error('Parking with that parkingId exists.'))
        : true
    })
    .then(status =>
      dynamoDb.put({
        TableName: PARKINGS_TABLE,
        Item: {
          parkingId: body.parkingId,
          name: body.name
        }}).promise()
    )
    .then(parking => {
      console.log("PARKINGRETURN: " + util.inspect(parking))
      return parking
    })
}

function checkIfInputIsValid(body){
  if (
    !(body.parkingId &&
      body.parkingId.length >= 2)
  ) {
    return Promise.reject(new Error('Parking error.'));
  }

  if (
    !(body.name &&
      body.name.length > 5 &&
      typeof body.name === 'string')
  ) return Promise.reject(new Error('name error. name needs to longer than 5 characters'));
  return Promise.resolve();
}

function getAllReservations(date) {
  //TODO: Process input date
  return dynamoDb.scan({
            TableName: PARKINGS_TABLE,
          }).promise()
    .then(parkings => {
      let reservations = parkings.Items.map(parking => {
        let test = queryReservation(parking.parkingId, date)
        .then(reservation => {
          return reservation;
        })
        return test;
      })
      return Promise.all(reservations).then(result => result)
    });
}

module.exports.handler = serverless(app, {
  request: function(request, event, context) {
    request.context = event.requestContext;
  }
})
