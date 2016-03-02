'use strict';

var bitcore = require('bitcore-lib');
var _ = bitcore.deps._;
var $ = bitcore.util.preconditions;
var common = require('./common');
var async = require('async');

function TxController(node) {
  this.node = node;
}

TxController.prototype.show = function(req, res) {
  if (req.transaction) {
    res.jsonp(req.transaction);
  }
};

/**
 * Find transaction by hash ...
 */
TxController.prototype.transaction = function(req, res, next, txid) {
  var self = this;

  this.node.getTransactionWithBlockInfo(txid, true, function(err, transaction) {
    if (err && err instanceof self.node.errors.Transaction.NotFound) {
      return common.handleErrors(null, res);
    } else if(err) {
      return common.handleErrors(err, res);
    }

    transaction.populateInputs(self.node.services.db, [], function(err) {
      if(err) {
        return res.send({
          error: err.toString()
        });
      }

      self.transformTransaction(transaction, false, function(err, transformedTransaction) {
        if (err) {
          return common.handleErrors(err, res);
        }
        req.transaction = transformedTransaction;
        next();
      });

    });
  });
};

TxController.prototype.transformTransaction = function(transaction, withConfirmations, callback) {
  $.checkArgument(_.isFunction(callback));
  var self = this;
  var txid = transaction.id;
  var txObj = transaction.toObject();

  var l_time = txObj.nLockTime < 500000000 ? txObj.nLockTime : new Date(txObj.nLockTime).toISOString();
  var b_height = transaction.__height < 0 ? null : transaction.__height;

  var transformed = {
    hash: txObj.hash,
    received_at: null
  };

  if(withConfirmations) {
    var conf_nb = 0;
    if(transaction.__height >= 0) {
      conf_nb = self.node.services.db.tip.__height - transaction.__height + 1;
    }
    transformed.confirmations = conf_nb;
  }

  transformed.lock_time = l_time,
  transformed.block =  {
    hash: null,
    height: b_height,
    time: null
  };

  transformed.inputs = null;
  transformed.outputs = null;
  transformed.fees = 0;
  transformed.amount = 0;

  if(transaction.isCoinbase()) {
    transformed.inputs = [
      {
        coinbase: txObj.inputs[0].script,
        sequence: txObj.inputs[0].sequenceNumber,
        input_index: 0
      }
    ];
  } else {
    transformed.inputs = txObj.inputs.map(this.transformInput.bind(this));
  }

  async.map(
    Object.keys(txObj.outputs),
    function(outputIndex, next) {
      outputIndex = parseInt(outputIndex);
      var output = txObj.outputs[outputIndex];
      self.transformOutput(output, outputIndex, next);
    },
    function(err, outputs) {
      if (err) {
        return callback(err);
      }

      transformed.outputs = outputs;

      if(transaction.__blockHash != "") { transformed.block.hash = transaction.__blockHash; }

      var time = transaction.__timestamp ? transaction.__timestamp * 1000 : Math.round(Date.now());
      time = new Date(time);
      transformed.received_at = time.toISOString();
      if (transaction.__height >=0) {
        transformed.block.time = time.toISOString(false);
      }


      transformed.amount = transaction.outputAmount;
      if(transaction.hasAllUtxoInfo()) {
        transformed.fees = transaction.getFee();
      }

      callback(null, transformed);
    }
  );

};

TxController.prototype.transformInput = function(input, index) {
  // Input scripts are validated and can be assumed to be valid
  var transformed = {
    output_hash: input.prevTxId,
    output_index: input.outputIndex,
    input_index: index
  };

  if(input.output) {
    transformed.value = input.output.satoshis;
    transformed.address = bitcore.Script(input.output.script).toAddress(this.node.network).toString();
  }

  transformed.script_signature = input.script;

  return transformed;
};

TxController.prototype.transformOutput = function(output, index, callback) {
  var transformed = {
    output_index: index,
    value: output.satoshis
  };

  var script;
  try {
    // Output scripts can be invalid, so we need to try/catch
    script = new bitcore.Script(output.script);
  } catch (err) {
    script = false;
  }
  if (script) {
    var address = script.toAddress(this.node.network);
    if (address) {
      transformed.address = address.toString();
    }
  }

  transformed.script_hex = output.script;

  callback(null, transformed);
};

TxController.prototype.transformInvTransaction = function(transaction, callback) {
  var self = this;

  var txid = transaction.toObject().hash;

  this.node.getTransactionWithBlockInfo(txid, true, function(err, transaction) {
    if (err) {
      return callback(err);
    }

    transaction.populateInputs(self.node.services.db, [], function(err) {
      if(err) {
        return callback(err);
      }

      self.transformTransaction(transaction, false, function(err, transformedTransaction) {
        if (err) {
          return callback(err);
        }

        var transformed = {
          dropped: 0,
          payload: {
            type: "new-transaction",
            block_chain: "bitcoin",
            transaction: transformedTransaction
          }
        };

        callback(null, transformed);
      });
    });
  });
};

TxController.prototype.rawTransaction = function(req, res, next, txid) {
  var self = this;

  this.node.getTransaction(txid, true, function(err, transaction) {
    if (err && err instanceof self.node.errors.Transaction.NotFound) {
      return common.handleErrors(null, res);
    } else if(err) {
      return common.handleErrors(err, res);
    }

    req.rawTransaction = {
      'transaction_hash': txid,
      'hex': transaction.toBuffer().toString('hex')
    };

    next();
  });
};

TxController.prototype.showRaw = function(req, res) {
  if (req.rawTransaction) {
    res.jsonp(req.rawTransaction);
  }
};

TxController.prototype.list = function(req, res) {
  var self = this;

  var blockHash = req.query.block;
  var address = req.query.address;
  var page = parseInt(req.query.pageNum) || 0;
  var pageLength = 10;
  var pagesTotal = 1;

  if(blockHash) {
    self.node.getBlock(blockHash, function(err, block) {
      if(err && err.message === 'Block not found.') {
        return common.handleErrors(null, res);
      } else if(err) {
        return common.handleErrors(err, res);
      }

      var blockInfo = self.node.services.bitcoind.getBlockIndex(block.hash);
      var txs = block.transactions;
      var totalTxs = txs.length;

      if(!_.isUndefined(page)) {
        txs = txs.splice(page * pageLength, pageLength);
        pagesTotal = Math.ceil(totalTxs / pageLength);
      }

      async.mapSeries(txs, function(tx, next) {
        tx.__blockHash = block.hash;
        tx.__height = blockInfo.height;
        tx.__timestamp = block.header.time;

        tx.populateInputs(self.node.services.db, [], function(err) {
          if(err) {
            return next(err);
          }
          self.transformTransaction(tx, false, next);
        });
      }, function(err, transformed) {
        if(err) {
          return common.handleErrors(err, res);
        }

        res.jsonp({
          pagesTotal: pagesTotal,
          txs: transformed
        });
      });
    });
  } else if(address) {
    var options = {
      from: page * pageLength,
      to: (page + 1) * pageLength
    };

    self.node.getAddressHistory(address, options, function(err, result) {
      if(err) {
        return common.handleErrors(err, res);
      }

      var txs = result.items.map(function(info) {
        return info.tx;
      }).filter(function(value, index, self) {
        return self.indexOf(value) === index;
      });

      async.map(
        txs,
        function(tx, next) {
          self.transformTransaction(tx, false, next);
        },
        function(err, transformed) {
          if (err) {
            return common.handleErrors(err, res);
          }
          res.jsonp({
            pagesTotal: Math.ceil(result.totalCount / pageLength),
            txs: transformed
          });
        }
      );
    });
  } else {
    return common.handleErrors(new Error('Block hash or address expected'), res);
  }
};

TxController.prototype.send = function(req, res) {
  this.node.sendTransaction(req.body.rawtx, function(err, txid) {
    if(err) {
      // TODO handle specific errors
      return common.handleErrors(err, res);
    }

    res.json({'transaction_hash': txid});
  });
};

module.exports = TxController;