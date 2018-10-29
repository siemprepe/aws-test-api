const serverless = require('serverless-http');
const bodyParser = require('body-parser');
const express = require('express');
const AWS = require('aws-sdk');
const jwt = require('jsonwebtoken');
const util = require('util');
const uuidv1 = require('uuid/v1');
const roleCheckMiddleware = require('../auth/roleCheckMiddleware');
const app = express();

const RESERVATIONS_TABLE = process.env.RESERVATIONS_TABLE;
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

var router = express.Router()
roleCheckMiddleware.applyRoleCheckMiddleware(router);

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.use(bodyParser.json({ strict: false }));

app.get('/reservations/:date', function(req, res){
  console.log("RESERVATIONS input date " + req.params.date)
  return getAllReservations(req.params.date)
    .then(session =>
      res.json(session)
    )
    .catch(err =>
      res.status(err.statusCode || 500).json({ error: err.message })
    );
})

router.post('/reservations', function(req,res){
  console.log("Add Reservation: " + JSON.stringify(req.body))
  return addReservation(req.body)
    .then(session =>
      res.json(session)
    )
    .catch(err =>
      res.status(err.statusCode || 500).json({ error: err.message })
    );
})
router.delete('/reservations/:parking/:date', function(req,res){
  const {date, parking} = req.params;
  console.log(`Delete Reservation on ${date} for ${parking}`);
  return deleteReservation(date, parking)
    .then(session =>
      res.json(session)
    )
    .catch(err =>
      res.status(err.statusCode || 500).json({ error: err.message })
    );
})

function deleteReservation(date, parking){
  return dynamoDb.delete({
    TableName : RESERVATIONS_TABLE,
    Key: {
      parkingId: parking,
      reservationDate: date
    }
  }).promise()
  .then(result => {
    return {success: true}
  });
}

function addReservation(body) {
  return checkIfInputIsValid(body) // validate input
    .then(() => (
      dynamoDb.get({
        TableName: RESERVATIONS_TABLE,
        Key: {
          parkingId: body.parkingId,
          reservationDate: body.reservationDate
        },
      }).promise()
    ))
    .then(reservation => {
      console.log("RESERVFOUND: " + util.inspect(reservation))
      return reservation && reservation.Item && reservation.Item.parkingId
        ? Promise.reject(new Error('Reservation with that parkingId and date exists.'))
        : true
    })
    .then(status =>
      dynamoDb.put({
        TableName: RESERVATIONS_TABLE,
        Item: {
          parkingId: body.parkingId,
          reservationDate: body.reservationDate,
          userId: body.userId,
          id: uuidv1()
        }}).promise()
    )
    .then(reservation => {
      console.log("RESERVRETURN: " + util.inspect(reservation))
      return reservation
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
    !(body.userId &&
      body.userId.length > 5 &&
      typeof body.userId === 'string')
  ) return Promise.reject(new Error('UserId error. UserId needs to longer than 5 characters'));

  if (
    !(body.reservationDate &&
      body.reservationDate.length > 9 &&
      typeof body.reservationDate === 'string' &&
      isValidDate(body.reservationDate))
  ) return Promise.reject(new Error('Date error. Date needs to be in YYYY-MM-DD format'));
  return Promise.resolve();
}

function isValidDate(dateString) {
  var regEx = /^\d{4}-\d{2}-\d{2}$/;
  if(!dateString.match(regEx)) return false;  // Invalid format
  var d = new Date(dateString);
  if(Number.isNaN(d.getTime())) return false; // Invalid date
  return d.toISOString().slice(0,10) === dateString;
}

function getAllReservations(date) {
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

function queryReservation(id, date){
  return dynamoDb.query({
    TableName: RESERVATIONS_TABLE,
    KeyConditionExpression: 'parkingId = :parkingId and begins_with (reservationDate,:date)',
    ExpressionAttributeValues : {':parkingId' : id,':date':date}
  }).promise()
  .then(reservations => {
    return reservations.Items
  });
}

app.use('/', router);

module.exports.handler = serverless(app, {
  request: function(request, event, context) {
    request.context = event.requestContext;
  }
})
