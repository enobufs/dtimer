'use strict';

var fs = require('fs');
var util = require('util');
var events = require('events');
var async = require('async');
var _und = require('underscore');

var logger = {
    debug: noop,
    warn: noop,
    info: noop,
    error: noop,
};
function noop () {}

// defaults
var defaults = {
    ns: 'dt',
    maxEvents: 1
};

// scripts
var scripts = {
    update: {
        script: fs.readFileSync(__dirname + '/update.lua', {encoding:'utf8'})
    }
};


// Redis key name policy
// Global hash: $ns + ':' + 'gl', hash {field-name, value}
//    o lastId
// Channel table    : $ns + ':' + 'chs', hash-set {last-ts, node-id}
// Event table   : $ns + ':' + 'evs', hash {field-name, value}

function DTimer(id, pub, sub, option) {
    var self = this;
    this._timer = null;
    this._option = _und.defaults(option || {}, defaults);
    this._pub = pub;
    if (!this._pub) {
        throw new Error('Redis client (pub) is missing');
    }
    this._sub = sub;
    if (this._sub) {
        this._sub.on("message", this._onSubMessage.bind(this));
    }
    this._keys = {
        gl: self._option.ns + ':gl',
        ch: self._option.ns + ':ch',
        ei: self._option.ns + ':ei',
        ed: self._option.ns + ':ed'
    };
    this._id = this._keys.ch + ':' + id; // subscriber channel
    this._readyCbs = [];
    this._lur = require('lured').create(this._pub, scripts);
    this._lur.on('state', function(from, to) {
        void(from);
        logger.debug(self._id+': statechange: %d -> %d', from, to);
        if (to === 3) {
            self._readyCbs.forEach(function(cb) { cb(); });
        }
    });
    this._lur.load(function (err) {
        if (err) {
            logger.error(self._id+': lua loading failed: ' + err.name);
            return;
        }
        logger.debug(self._id+': lua loading successful');
    });
    this._maxEvents = this._option.maxEvents;
}

util.inherits(DTimer, events.EventEmitter);

DTimer.prototype.setMaxEvents = function (num) {
    this._maxEvents = num;
};

/** @private */
DTimer.prototype._onSubMessage = function (chId, msg) {
    try {
        var o = JSON.parse(msg);
        if (typeof o.interval === 'number') {
            if (this._timer) {
                clearTimeout(this._timer);
            }
            logger.debug(this._id+': new interval (1) ' + o.interval);
            this._timer = setTimeout(this._onTimeout.bind(this), o.interval);
        }
    } catch (e) {
        logger.error('Malformed message:', msg);
    }
};

DTimer.prototype._callOnReady = function (cb) {
    var self = this;
    if (this._lur.state !== 3) {
        this._readyCbs.push(cb);
        return;
    }
    cb();
};

DTimer.prototype.join = function (cb) {
    if (!this._sub) {
        cb(new Error('Can not join without redis client (sub)'));
    }
    var self = this;
    this._callOnReady(function (err) {
        if (err) { return void(cb(err)); }
        self._join(cb);
    });
};

DTimer.prototype._redisTime = function (client, cb) {
    client.time(function (err, result) {
        if (err) { return void(cb(err)); }
        cb(null, result[0] * 1000 + Math.floor(result[1] / 1000));
    });
};

DTimer.prototype._join = function (cb) {
    // Subscribe first.
    var self = this;
    this._sub.subscribe(this._id);
    this._sub.once('subscribe', function () {
        self._redisTime(self._pub, function (err, now) {
            if (err) {return void(cb(err)); }
            self._pub.multi()
            .lrem(self._keys.ch, 0, self._id)
            .lpush(self._keys.ch, self._id)
            .evalsha(
                scripts.update.sha,
                4,
                self._keys.gl,
                self._keys.ch,
                self._keys.ei,
                self._keys.ed,
                '',
                now,
                0)
            .exec(function(err, replies) {
                if (err) {
                    logger.error(self._id+': join failed: ' + err.name);
                    return void(cb(err));
                }
                if (self._timer) {
                    clearTimeout(self._timer);
                }
                logger.debug(self._id+': new interval (2) ' + replies[2][1]);
                self._timer = setTimeout(self._onTimeout.bind(self), replies[2][1]);
                cb();
            });
        });
    });
};

DTimer.prototype.leave = function (cb) {
    if (!this._sub) {
        cb(new Error('Can not leave without redis client (sub)'));
    }
    var self = this;
    this._callOnReady(function (err) {
        if (err) { return void(cb(err)); }
        self._leave(cb);
    });
};

DTimer.prototype._leave = function (cb) {
    var self = this;
    if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
    }
    this._redisTime(self._pub, function (err, now) {
        if (err) { return void(cb(err)); }
        self._pub.multi()
        .lrem(self._keys.ch, 0, self._id)
        .evalsha(
            scripts.update.sha,
            4,
            self._keys.gl,
            self._keys.ch,
            self._keys.ei,
            self._keys.ed,
            '',
            now,
            0)
        .exec(function () {
            self._sub.unsubscribe(self._id);
            self._sub.once('unsubscribe', cb);
        });
    });
};

DTimer.prototype.post = function (ev, delay, cb) {
    var self = this;
    var msg;
    if (typeof ev === 'object') {
        msg = JSON.stringify(ev);
    }
    this._callOnReady(function (err) {
        if (err) { return void(cb(err)); }
        self._post(msg, delay, cb);
    });
};

DTimer.prototype._post = function (msg, delay, cb) {
    var self = this;
    this._redisTime(self._pub, function (err, now) {
        if (err) { return void(cb(err)); }
        self._pub.hincrby(self._keys.gl, 'eventId', 1, function (err, evId) {
            if (err) { return void(cb(err)); }
            self._pub.multi()
            .zadd(self._keys.ei, now+delay, evId)
            .hset(self._keys.ed, evId, msg)
            .evalsha(
                scripts.update.sha,
                4,
                self._keys.gl,
                self._keys.ch,
                self._keys.ei,
                self._keys.ed,
                '',
                now,
                0)
            .exec(function (err, replies) {
                if (err) { return void(cb(err)); }
                cb(null, evId);
            });
        });
    });
};

DTimer.prototype._onTimeout = function () {
    var self = this;
    this._timer = null;
    this._redisTime(self._pub, function (err, now) {
        if (err) { return void(cb(err)); }
        self._pub.evalsha(
            scripts.update.sha,
            4,
            self._keys.gl,
            self._keys.ch,
            self._keys.ei,
            self._keys.ed,
            self._id,
            now,
            self._maxEvents,
            function (err, replies) {
                var interval;
                if (err) {
                    interval = 3000;
                    logger.error(self._id+': update failed: ' + err.name);
                } else {
                    interval = replies[1];
                    if (replies[0].length > 0) {
                        var events = [];
                        replies[0].forEach(function (sev) {
                            try {
                                events.push(JSON.parse(sev));
                            } catch (e) {
                                logger.error(self._id+': fail to parse event. ' + JSON.stringify(e));
                            }
                        });
                        self.emit('event', events);
                    }
                }
                if (!self._timer) {
                    logger.debug(self._id+': new interval (3) ' + interval);
                    self._timer = setTimeout(self._onTimeout.bind(self), interval);
                }
            }
        );
    });
};


module.exports.DTimer = DTimer;
module.exports.logger = logger;
