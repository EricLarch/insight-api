'use strict';

exports.notReady = function (err, res, p) {
  res.status(503).send('Server not yet ready. Sync Percentage:' + p);
};

exports.handleErrors = function (err, res) {
  if (err) {
    if (err.code)  {
      res.status(400).send(err.message + '. Code:' + err.code);
    }
    else {
      res.status(503).send(err.message);
    }
  }
  else {
    res.status(404).send('Not found');
  }
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