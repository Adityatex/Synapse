'use strict';

const crypto = require('crypto');

function requestIdMiddleware(req, res, next) {
  const incoming = req.headers['x-request-id'];
  const id =
    (Array.isArray(incoming) ? incoming[0] : incoming) ||
    (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex'));
  req.id = String(id).slice(0, 128);
  res.setHeader('X-Request-Id', req.id);
  next();
}

module.exports = { requestIdMiddleware };
