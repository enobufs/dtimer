'use strict';

var fs = require('fs');
var util = require('util');
var events = require('events');
var _und = require('underscore');
var debug = require('debug')('dtimer');

// defaults
var defaults = {
    ns: 'dt',
    maxEvents: 8,
    readyTimeout: 30 // in seconds
};

// scripts
var scripts = {
    update: {
        script: fs.readFileSync(__dirname + '/update.lua', 'utf8')
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
        if (typeof id !== 'string' || id.length === 0) {
            throw new Error('The id must be non-empty string');
        }
    } else {
        id = 'post-only';
    }
    this._keys = {
        gl: self._option.ns + ':gl',
        ch: self._option.ns + ':ch',
        ei: self._option.ns + ':ei',
        ed: self._option.ns + ':ed'
    };
    this._id = this._keys.ch + ':' + id; // subscriber channel
    this._readyCbs = [];
    this._readyCbTimer = null;
    this._lur = require('lured').create(this._pub, scripts);
    this._lur.on('state', function(from, to) {
        void(from);
        debug(self._id+': statechange: %d -> %d', from, to);
        if (to === 3) {
            self._readyCbs.forEach(function(cb) { cb(); });
        }
    });
    this._lur.load(function (err) {
        if (err) {
            debug(self._id+': lua loading failed: ' + err.name);
            self.emit('error', err);
            return;
        }
        debug(self._id+': lua loading successful');
    });
    this._maxEvents = this._option.maxEvents;

    // Define getter 'maxEvents'
    this.__defineGetter__("maxEvents", function () {
        return this._maxEvents;
    });
    // Define setter 'maxEvents'
    this.__defineSetter__("maxEvents", function (num) {
        this._maxEvents = (num > 0)? num:this._option.maxEvents;
    });
}

util.inherits(DTimer, events.EventEmitter);

/** @private */
DTimer.prototype._onSubMessage = function (chId, msg) {
    try {
        var o = JSON.parse(msg);
        if (typeof o.interval === 'number') {
            if (this._timer) {
                clearTimeout(this._timer);
            }
            debug(this._id+': new interval (1) ' + o.interval);
            this._timer = setTimeout(this._onTimeout.bind(this), o.interval);
        }
    } catch (e) {
        debug('Malformed message:', msg);
        this.emit('error', e);
    }
};

DTimer.prototype._callOnReady = function (cb) {
    var self = this;
    if (this._lur.state !== 3) {
        this._readyCbs.push(cb);
        if (!this._readyCbTimer) {
            this._readyCbTimer = setTimeout(function () {
                self._readyCbTimer = null;
                self._readyCbs.forEach(function (cb) {
                    cb(new Error('Operation timed out'));
                });
            }, self._option.readyTimeout*1000);
        }
        return;
    }
    cb();
};

DTimer.prototype.join = function (cb) {
    if (!this._sub) {
        return void(cb(
            new Error('Can not join without redis client (sub)')
        ));
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
                    debug(self._id+': join failed: ' + err.name);
                    return void(cb(err));
                }
                if (self._timer) {
                    clearTimeout(self._timer);
                }
                debug(self._id+': new interval (2) ' + replies[2][1]);
                self._timer = setTimeout(self._onTimeout.bind(self), replies[2][1]);
                cb();
            });
        });
    });
};

DTimer.prototype.leave = function (cb) {
    if (!this._sub) {
        return void(cb(
            new Error('Can not leave without redis client (sub)')
        ));
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
    if (typeof ev !== 'object') {
        throw new Error('event data must be of type object');
    }
    var msg = JSON.stringify(ev);
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

DTimer.prototype.cancel = function (evId, cb) {
    var self = this;
    this._callOnReady(function (err) {
        if (err) { return void(cb(err)); }
        self._cancel(evId, cb);
    });
};

DTimer.prototype._cancel = function (evId, cb) {
    var self = this;
    this._redisTime(self._pub, function (err, now) {
        if (err) { return void(cb(err)); }
        self._pub.multi()
        .zrem(self._keys.ei, evId)
        .hdel(self._keys.ed, evId)
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
        .exec(function (err) {
            cb(err);
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
                    debug(self._id+': update failed: ' + err.name);
                } else {
                    interval = replies[1];
                    if (replies[0].length > 0) {
                        replies[0].forEach(function (sev) {
                            var ev;
                            try {
                                ev = JSON.parse(sev);
                            } catch (e) {
                                debug(self._id+': fail to parse event. ' + JSON.stringify(e));
                                return;
                            }
                            self.emit('event', ev);
                        });
                    }
                }
                if (!self._timer) {
                    debug(self._id+': new interval (3) ' + interval);
                    self._timer = setTimeout(self._onTimeout.bind(self), interval);
                }
            }
        );
    });
};


module.exports.DTimer = DTimer;
