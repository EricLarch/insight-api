'use strict';
var _ = require('lodash');

function UtilsController(node) {
  this.node = node;
}

UtilsController.prototype.estimateFee = function(req, res) {
  var self = this;
  var args = req.query.nbBlocks || '2';
  var nbBlocks = args.split(',');

  var result = nbBlocks.map(function(n) {
    var num = parseInt(n);
    // Insight and Bitcoin JSON-RPC return bitcoin for this value (instead of satoshis).
    var fee = self.node.services.bitcoind.estimateFee(num) / 1e8;
    return [num, fee];
  });

  res.jsonp(_.zipObject(result));
};

function pad(number) {
  if (number < 10) {
    return '0' + number;
  }
  return number;
}

Date.prototype.toISOString = function(withMilliSeconds) {
  var ISOString = this.getUTCFullYear() +
    '-' + pad(this.getUTCMonth() + 1) +
    '-' + pad(this.getUTCDate()) +
    'T' + pad(this.getUTCHours()) +
    ':' + pad(this.getUTCMinutes()) +
    ':' + pad(this.getUTCSeconds());

  if(withMilliSeconds == true) {
    ISOString = ISOString + '.' + (this.getUTCMilliseconds() / 1000).toFixed(3).slice(2, 5);
  }

  ISOString = ISOString + 'Z';

  return ISOString;
};

module.exports = UtilsController;
