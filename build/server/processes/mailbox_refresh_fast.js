// Generated by CoffeeScript 1.9.1
var MailboxRefreshFast, Message, Process, _, async, log,
  bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
  extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
  hasProp = {}.hasOwnProperty,
  indexOf = [].indexOf || function(item) { for (var i = 0, l = this.length; i < l; i++) { if (i in this && this[i] === item) return i; } return -1; };

Process = require('./_base');

async = require('async');

Message = require('../models/message');

_ = require('lodash');

log = require('../utils/logging')({
  prefix: 'process:box_refresh_fast'
});

module.exports = MailboxRefreshFast = (function(superClass) {
  extend(MailboxRefreshFast, superClass);

  function MailboxRefreshFast() {
    this.refreshDeletion = bind(this.refreshDeletion, this);
    this.fetchImapUIDs = bind(this.fetchImapUIDs, this);
    this.fetchCozyUIDs = bind(this.fetchCozyUIDs, this);
    this.checkNeedDeletion = bind(this.checkNeedDeletion, this);
    this.refreshCreatedAndUpdated = bind(this.refreshCreatedAndUpdated, this);
    this.fetchCozyMessagesForChanges = bind(this.fetchCozyMessagesForChanges, this);
    this.fetchChanges = bind(this.fetchChanges, this);
    return MailboxRefreshFast.__super__.constructor.apply(this, arguments);
  }

  MailboxRefreshFast.prototype.code = 'mailbox-refresh-fast';

  MailboxRefreshFast.algorithmFailure = {
    Symbol: 'fastFailure'
  };

  MailboxRefreshFast.prototype.initialize = function(options, callback) {
    this.shouldNotif = false;
    this.nbAdded = 0;
    this.mailbox = options.mailbox;
    this.lastHighestModSeq = this.mailbox.lastHighestModSeq;
    this.lastTotal = this.mailbox.lastTotal || 0;
    this.changes = {};
    this.changedUids = [];
    return async.series([this.fetchChanges, this.fetchCozyMessagesForChanges, this.refreshCreatedAndUpdated, this.checkNeedDeletion, this.refreshDeletion], callback);
  };

  MailboxRefreshFast.prototype.fetchChanges = function(next) {
    log.debug("fetchChanges");
    return this.mailbox.doLaterWithBox((function(_this) {
      return function(imap, imapbox, releaseImap) {
        _this.newHighestModSeq = imapbox.highestmodseq;
        _this.newImapTotal = imapbox.messages.total;
        if (_this.newHighestModSeq === _this.lastHighestModSeq) {
          return releaseImap();
        } else {
          return imap.fetchMetadataSince(_this.lastHighestModSeq, function(err, changes) {
            if (err) {
              return next(err);
            }
            _this.changes = changes;
            _this.changedUids = Object.keys(changes);
            return releaseImap(err);
          });
        }
      };
    })(this), next);
  };

  MailboxRefreshFast.prototype.fetchCozyMessagesForChanges = function(callback) {
    var keys;
    if (!this.changedUids.length) {
      return callback(null);
    }
    log.debug("fetchCozyMessagesForChanges");
    keys = this.changedUids.map((function(_this) {
      return function(uid) {
        return ['uid', _this.mailbox.id, parseInt(uid)];
      };
    })(this));
    return Message.rawRequest('byMailboxRequest', {
      reduce: false,
      keys: keys,
      include_docs: true
    }, (function(_this) {
      return function(err, rows) {
        var i, len, row, uid;
        _this.cozyMessages = {};
        if (err) {
          return callback(err);
        }
        for (i = 0, len = rows.length; i < len; i++) {
          row = rows[i];
          uid = row.key[2];
          _this.cozyMessages[uid] = new Message(row.doc);
        }
        return callback(null);
      };
    })(this));
  };

  MailboxRefreshFast.prototype.refreshCreatedAndUpdated = function(callback) {
    log.debug("refreshCreatedAndUpdated");
    return async.eachSeries(this.changedUids, (function(_this) {
      return function(uid, next) {
        var flags, message, mid, ref;
        ref = _this.changes[uid], mid = ref[0], flags = ref[1];
        uid = parseInt(uid);
        message = _this.cozyMessages[uid];
        if (message && !_.xor(message.flags, flags).length) {
          return setImmediate(next);
        } else if (message) {
          _this.noChange = false;
          return message.updateAttributes({
            flags: flags
          }, next);
        } else {
          return Message.fetchOrUpdate(_this.mailbox, {
            mid: mid,
            uid: uid
          }, function(err, info) {
            _this.shouldNotif || (_this.shouldNotif = info.shouldNotif);
            if (info != null ? info.actuallyAdded : void 0) {
              _this.nbAdded += 1;
            }
            return next(err);
          });
        }
      };
    })(this), callback);
  };

  MailboxRefreshFast.prototype.checkNeedDeletion = function(callback) {
    log.debug("refreshDeleted L=" + this.lastTotal + " A=" + this.nbAdded + " I=" + this.newImapTotal);
    if (this.lastTotal + this.nbAdded === this.newImapTotal) {
      this.needDeletion = false;
      return callback(null);
    } else if (this.lastTotal + this.nbAdded < this.newImapTotal) {
      log.warn(this.lastTotal + " + " + this.nbAdded + " < " + this.newImapTotal + " on " + this.path);
      return callback(MailboxRefreshFast.algorithmFailure);
    } else {
      this.needDeletion = true;
      return callback(null);
    }
  };

  MailboxRefreshFast.prototype.fetchCozyUIDs = function(callback) {
    return Message.rawRequest('byMailboxRequest', {
      startkey: ['uid', this.mailbox.id],
      endkey: ['uid', this.mailbox.id, {}],
      reduce: true,
      group_level: 3
    }, (function(_this) {
      return function(err, rows) {
        var row;
        if (err) {
          return callback(err);
        }
        _this.cozyUIDs = (function() {
          var i, len, results;
          results = [];
          for (i = 0, len = rows.length; i < len; i++) {
            row = rows[i];
            results.push(row.key[2]);
          }
          return results;
        })();
        return callback(null);
      };
    })(this));
  };

  MailboxRefreshFast.prototype.fetchImapUIDs = function(callback) {
    return this.mailbox.doLaterWithBox(function(imap, imapbox, cb) {
      return imap.fetchBoxMessageUIDs(cb);
    }, (function(_this) {
      return function(err, imapUIDs) {
        if (err) {
          return callback(err);
        }
        _this.imapUIDs = imapUIDs;
        return callback(null);
      };
    })(this));
  };

  MailboxRefreshFast.prototype.fetchCozyMessagesForDeletion = function(callback) {
    var keys;
    keys = this.deletedUIDs.map((function(_this) {
      return function(uid) {
        return ['uid', _this.mailbox.id, uid];
      };
    })(this));
    return Message.rawRequest('byMailboxRequest', {
      reduce: false,
      keys: keys,
      include_docs: true
    }, (function(_this) {
      return function(err, rows) {
        if (err) {
          return callback(err);
        }
        _this.deletedMessages = rows.map(function(row) {
          return new Message(row.doc);
        });
        log.debug("refreshDeleted#toDeleteMsgs", _this.deletedMessages.length);
        return callback(null);
      };
    })(this));
  };

  MailboxRefreshFast.prototype.refreshDeletion = function(callback) {
    if (!this.needDeletion) {
      return callback(null);
    }
    return async.series([
      (function(_this) {
        return function(cb) {
          return _this.fetchCozyUIDs(cb);
        };
      })(this), (function(_this) {
        return function(cb) {
          return _this.fetchImapUIDs(cb);
        };
      })(this), (function(_this) {
        return function(cb) {
          var i, len, ref, uid;
          log.debug("refreshDeleted#uids", _this.cozyUIDs.length, _this.imapUIDs.length);
          _this.deletedUIDs = [];
          ref = _this.cozyUIDs;
          for (i = 0, len = ref.length; i < len; i++) {
            uid = ref[i];
            if (indexOf.call(_this.imapUIDs, uid) < 0) {
              _this.deletedUIDs.push(uid);
            }
          }
          return _this.fetchCozyMessagesForDeletion(cb);
        };
      })(this), (function(_this) {
        return function(cb) {
          return async.eachSeries(_this.deletedMessages, function(message, next) {
            return message.removeFromMailbox(_this.mailbox, false, next);
          }, cb);
        };
      })(this)
    ], callback);
  };

  MailboxRefreshFast.prototype.storeLastSync = function(callback) {
    if (this.newImapTotal !== this.mailbox.lastTotal || this.newHighestModSeq !== this.mailbox.lastHighestModSeq) {
      return this.mailbox.updateAttributes({
        lastHighestModSeq: this.newHighestModSeq,
        lastTotal: this.newImapTotal,
        lastSync: new Date().toISOString()
      }, callback);
    }
  };

  return MailboxRefreshFast;

})(Process);
