const jwt = require('jsonwebtoken'); // used to create, sign, and verify tokens

// Policy helper function
const generatePolicy = (decoded, effect, resource) => {
  const authResponse = {};
  authResponse.principalId = decoded.id;
  if (effect && resource) {
    const policyDocument = {};
    policyDocument.Version = '2012-10-17';
    policyDocument.Statement = [];
    const statementOne = {};
    statementOne.Action = 'execute-api:Invoke';
    statementOne.Effect = effect;
    statementOne.Resource = resource;
    policyDocument.Statement[0] = statementOne;
    authResponse.policyDocument = policyDocument;
  }
  authResponse.context = {
        "roles":decoded.roles
    };
  return authResponse;
}

module.exports.auth = (event, context, callback) => {

  // check header or url parameters or post parameters for token
  const token = event.authorizationToken;

  if (!token)
    return callback(null, 'Unauthorized');

  // verifies secret and checks exp
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err)
      return callback(null, 'Unauthorized');

    // if everything is good, save to request for use in other routes
    return callback(null, generatePolicy(decoded, 'Allow', event.methodArn))
  });

};
