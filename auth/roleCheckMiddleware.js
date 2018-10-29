var exports = module.exports = {};

exports.applyRoleCheckMiddleware = function(router) {
  router.use(function (req, res, next) {
    console.log('Checking Role')
    if(checkRole(req.context.authorizer.roles, 'ADMIN')){
      next();
    }else{
      res.status(403).json({ error: 'Unauthorized' })
    }
  })
};

function checkRole(roles, expectedRole){
  return roles !== null ? roles.split(';').find(role => role === expectedRole) : false
}
