'use strict';

var fs = require('fs');
var util = require('util');
var events = require('events');
var _und = require('underscore');
var debug = require('debug')('dtimer');
var uuid = require('uuid');
var Promise = require('bluebird');

Promise.promisifyAll(require('redis'));

// defaults
var defaults = {
    ns: 'dt',
    maxEvents: 8,
    readyTimeout: 30, // in seconds
    confTimeout: 10 // in seconds
};

// scripts
var scripts = {
    update: {
        script: fs.readFileSync(__dirname + '/lua/update.lua', 'utf8')
    },
    cancel: {
        script: fs.readFileSync(__dirname + '/lua/cancel.lua', 'utf8')
    },
    changeDelay: {
        script: fs.readFileSync(__dirname + '/lua/changeDelay.lua', 'utf8')
    }
};

// Workaround for in-result errors for multi operation.
// This will not be necessary with redis@>=2.0.0.
function throwIfMultiError(results) {
    results.forEach(function (res) {
        if (typeof res === 'string' && res.indexOf('ERR') === 0) {
            throw new Error(res);
        }
    });
}


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
        ed: self._option.ns + ':ed',
        et: self._option.ns + ':et'
    };
    this._id = this._keys.ch + ':' + id; // subscriber channel
    this._lur = require('lured').create(this._pub, scripts);
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
    void(chId);
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


DTimer.prototype.join = function (cb) {
    var self = this;
    return new Promise(function (resolve, reject) {
        if (!self._sub) {
            return reject(new Error('Can not join without redis client (sub)'));
        }

        self._sub.subscribe(self._id);
        self._sub.once('subscribe', function () {
            resolve();
        });
    })
    .then(function () {
        return self._redisTime();
    })
    .then(function (now) {
        return self._pub.multi()
        .lrem(self._keys.ch, 0, self._id)
        .lpush(self._keys.ch, self._id)
        .evalsha(
            scripts.update.sha,
            5,
            self._keys.gl,
            self._keys.ch,
            self._keys.ei,
            self._keys.ed,
            self._keys.et,
            '',
            now,
            0,
            self._option.confTimeout)
        .execAsync()
        .then(function (replies) {
            throwIfMultiError(replies);
            /* istanbul ignore if  */
            if (self._timer) {
                clearTimeout(self._timer);
            }
            debug(self._id+': new interval (2) ' + replies[2][1]);
            self._timer = setTimeout(self._onTimeout.bind(self), replies[2][1]);
        });
    })
    .nodeify(cb);
};

DTimer.prototype._redisTime = function () {
    return this._pub.timeAsync()
    .then(function (result) {
        return result[0] * 1000 + Math.floor(result[1] / 1000);
    });
};

DTimer.prototype.leave = function (cb) {
    if (!this._sub) {
        return Promise.reject(new Error('Can not leave without redis client (sub)')).nodeify(cb);

    }
    var self = this;

    if (this._timer) {
        clearTimeout(this._timer);
        this._timer = null;
    }

    return this._redisTime()
    .then(function (now) {
        return self._pub.multi()
        .lrem(self._keys.ch, 0, self._id)
        .evalsha(
            scripts.update.sha,
            5,
            self._keys.gl,
            self._keys.ch,
            self._keys.ei,
            self._keys.ed,
            self._keys.et,
            '',
            now,
            0,
            self._option.confTimeout)
        .execAsync()
        .then(throwIfMultiError);
    })
    .finally(function () {
        self._sub.unsubscribe(self._id);
        return new Promise(function (resolve) {
            self._sub.once('unsubscribe', function () {
                resolve();
            });
        });
    })
    .nodeify(cb);
};

DTimer.prototype.post = function (ev, delay, overwrite, cb) {
    var self = this;
    var evId;

    if (typeof delay !== 'number') {
        throw new Error('delay argument must be of type number');
    }
    if (typeof overwrite === 'function') {
        cb = overwrite;
        overwrite = undefined;
    }
    if (overwrite === undefined) {
        overwrite = true;
    }

    // Copy event.
    ev = JSON.parse(JSON.stringify(ev));

    if (typeof ev !== 'object') {
        throw new Error('event data must be of type object');
    }

    if (ev.hasOwnProperty('id')) {
        if (typeof ev.id !== 'string' || ev.id.length === 0) {
            throw new Error('event ID must be a non-empty string');
        }
    } else {
        ev.id = uuid.v4();
    }
    evId = ev.id;

    if (ev.hasOwnProperty('maxRetries')) {
        if (typeof ev.maxRetries !== 'number') {
            throw new Error('maxRetries must be a number');
        }
    } else {
        ev.maxRetries = 0;
    }

    var msg = JSON.stringify(ev);

    return this._redisTime()
    .then(function (now) {
        var zaddArgs = [ self._keys.ei, now+delay, evId ];
        if (!overwrite) {
            zaddArgs.unshift('NX');
        }
        var multi = self._pub.multi()
        return multi
        .zadd.apply(multi, zaddArgs)
        [overwrite ? 'hset' : 'hsetnx'](self._keys.ed, evId, msg)
        .evalsha(
            scripts.update.sha,
            5,
            self._keys.gl,
            self._keys.ch,
            self._keys.ei,
            self._keys.ed,
            self._keys.et,
            '',
            now,
            0,
            self._option.confTimeout)
        .execAsync()
        .then(function (results) {
            throwIfMultiError(results);
            return evId;
        });
    })
    .nodeify(cb);
};

DTimer.prototype.peek = function (evId, cb) {
    var self = this;

    return this._redisTime()
    .then(function (now) {
        return self._pub.multi()
        .zscore(self._keys.ei, evId)
        .hget(self._keys.ed, evId)
        .execAsync()
        .then(function (results) {
            throwIfMultiError(results);
            if (results[0] === null || results[1] === null) {
                return [null, null];
            }
            return [
                Math.max(parseInt(results[0]) - now, 0),
                JSON.parse(results[1])
            ];
        });
    })
    .nodeify(cb);
};

DTimer.prototype.cancel = function (evId, cb) {
    var self = this;

    return this._redisTime()
    .then(function (now) {
        return self._pub.multi()
        .evalsha(
            scripts.cancel.sha,
            2,
            self._keys.ei,
            self._keys.ed,
            evId)
        .evalsha(
            scripts.update.sha,
            5,
            self._keys.gl,
            self._keys.ch,
            self._keys.ei,
            self._keys.ed,
            self._keys.et,
            '',
            now,
            0,
            self._option.confTimeout)
        .execAsync()
        .then(function (results) {
            throwIfMultiError(results);
            return results[0];
        });
    })
    .nodeify(cb);
};

DTimer.prototype.confirm = function (evId, cb) {
    var self = this;

    return this._redisTime()
    .then(function (now) {
        return self._pub.multi()
        .evalsha(
            scripts.cancel.sha, // reuse cancel.lua script
            2,
            self._keys.et,
            self._keys.ed,
            evId)
        .evalsha(
            scripts.update.sha,
            5,
            self._keys.gl,
            self._keys.ch,
            self._keys.ei,
            self._keys.ed,
            self._keys.et,
            '',
            now,
            0,
            self._option.confTimeout)
        .execAsync()
        .then(function (results) {
            throwIfMultiError(results);
            return results[0];
        });
    })
    .nodeify(cb);
};

DTimer.prototype.changeDelay = function (evId, delay, cb) {
    var self = this;

    if (typeof delay !== 'number') {
        throw new Error('delay argument must be of type number');
    }

    return this._redisTime()
    .then(function (now) {
        return self._pub.multi()
        .evalsha(
            scripts.changeDelay.sha,
            1,
            self._keys.ei,
            evId,
            now+delay)
        .evalsha(
            scripts.update.sha,
            5,
            self._keys.gl,
            self._keys.ch,
            self._keys.ei,
            self._keys.ed,
            self._keys.et,
            '',
            now,
            0,
            self._option.confTimeout)
        .execAsync()
        .then(function (results) {
            throwIfMultiError(results);
            return results[0];
        });
    })
    .nodeify(cb);
};

DTimer.prototype._onTimeout = function () {
    var self = this;
    this._timer = null;
    this._redisTime()
    .then(function (now) {
        var interval;
        return self._pub.evalshaAsync(
            scripts.update.sha,
            5,
            self._keys.gl,
            self._keys.ch,
            self._keys.ei,
            self._keys.ed,
            self._keys.et,
            self._id,
            now,
            self._maxEvents,
            self._option.confTimeout)
        .then(function (replies) {
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
        }, function (err) {
            interval = 3000;
            debug(self._id+': update failed: ' + err.name);
        })
        .finally(function () {
            if (!self._timer) {
                debug(self._id+': new interval (3) ' + interval);
                self._timer = setTimeout(self._onTimeout.bind(self), interval);
            }
        });
    }, function (err) {
        self.emit('error', err);
    });
};

DTimer.prototype.upcoming = function (option, cb) {
    var self = this;
    var defaults = {
        offset: -1,
        duration: -1, // +inf
        limit: -1     // +inf
    };
    var _option;

    if (typeof option !== 'object') {
        cb = option;
        _option = defaults;
    } else {
        _option = _und.defaults(option, defaults);
    }

    return this._redisTime()
    .then(function (now) {
        var args = [ self._keys.ei ];
        var offset = 0;
        if (typeof _option.offset !== 'number' || _option.offset < 0) {
            args.push(0);
        } else {
            args.push(now + _option.offset);
            offset = _option.offset;
        }
        if (typeof _option.duration !== 'number' || _option.duration < 0) {
            args.push('+inf');
        } else {
            args.push(now + offset + _option.duration);
        }
        args.push('WITHSCORES');
        if (typeof _option.limit === 'number' && _option.limit > 0) {
            args.push('LIMIT');
            args.push(0);
            args.push(_option.limit);
        }
        debug('upcoming args: ' + JSON.stringify(args));

        return self._pub.zrangebyscoreAsync(args)
        .then(function (results) {
            if (results.length === 0) {
                return {};
            }

            var out = [];
            args = [ self._keys.ed ];
            for (var i = 0; i < results.length; i += 2) {
                out.push({ expireAt: parseInt(results[i+1]), id: results[i]});
                args.push(results[i]);
            }

            return self._pub.hmgetAsync(args)
            .then(function (results) {
                var outObj = {};
                results.forEach(function (evStr, index){
                    /* istanbul ignore if  */
                    if (!evStr) {
                        return;
                    }
                    /* istanbul ignore next  */
                    try {
                        var event = JSON.parse(evStr);
                    } catch (e) {
                        debug(self._id+': fail to parse event. ' + JSON.stringify(e));
                        return;
                    }
                    outObj[out[index].id] = { expireAt : out[index].expireAt, event: event };
                });
                return outObj;
            });
        });
    })
    .nodeify(cb);
};

module.exports.DTimer = DTimer;
