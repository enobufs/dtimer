'use strict';

var DTimer = require('..').DTimer;
var redis = require("redis");
var async = require('async');
var assert = require('assert');

describe('Single node', function () {
    var pub = null;
    var sub = null;
    var dt  = null;

    before(function () {
    });

    beforeEach(function (done) {
        var conns = 0;
        pub = redis.createClient();
        pub.once('ready', function () { conns++; });
        sub = redis.createClient();
        sub.once('ready', function () { conns++; });
        async.whilst(
            function () { return (conns < 2); },
            function (next) {
                setTimeout(next, 100);
            },
            function (err) {
                if (err) {
                    return void(done(err));
                }
                async.series([
                    function (next) {
                        pub.select(9, next);
                    },
                    function (next) {
                        pub.flushdb(next);
                    }
                ], function (err) {
                    if (err) { return void(done(err)); }
                    dt = new DTimer('ch1', pub, sub);
                    done();
                });
            }
        );
    });

    afterEach(function () {
        dt.removeAllListeners();
        dt = null;
        pub.removeAllListeners();
        pub.end();
        pub = null;
        sub.removeAllListeners();
        sub.end();
        sub = null;
    });

    it('Post and receive one event', function (done) {
        var evt = { msg: 'hello' };
        var delay = 500;
        async.series([
            function (next) {
                dt.join(function () {
                    next();
                });
            },
            function (next) {
                var since = Date.now();
                var numEvents = 0;
                dt.post(evt, delay, function (err) {
                    assert.ifError(err);
                });
                dt.on('event', function (ev) {
                    var elapsed = Date.now() - since;
                    numEvents++;
                    assert.deepEqual(ev, evt);
                    assert(elapsed < delay * 1.1);
                    assert(elapsed > delay * 0.9);
                });
                setTimeout(function() {
                    assert.equal(numEvents, 1);
                    next();
                }, 1000);
            },
            function (next) {
                dt.leave(function () {
                    next();
                });
            }
        ], function (err, results) {
            void(results);
            done(err);
        });
    });

    it('Post and receive many events', function (done) {
        var evts = [
            { msg: { msg: 'msg0' }, delay: 10 },
            { msg: { msg: 'msg1' }, delay: 10 },
            { msg: { msg: 'msg2' }, delay: 10 },
            { msg: { msg: 'msg3' }, delay: 10 },
            { msg: { msg: 'msg4' }, delay: 10 },
            { msg: { msg: 'msg5' }, delay: 10 },
            { msg: { msg: 'msg6' }, delay: 10 },
            { msg: { msg: 'msg7' }, delay: 10 },
            { msg: { msg: 'msg8' }, delay: 10 },
            { msg: { msg: 'msg9' }, delay: 10 }
        ];
        var numRcvd = 0;
        async.series([
            function (next) {
                dt.join(function () {
                    next();
                });
            },
            function (next) {
                var since = Date.now();
                evts.forEach(function (evt) {
                    dt.post(evt.msg, evt.delay, function (err, evId) {
                        evt.id = evId;
                        evt.postDelay = Date.now() - since;
                        evt.posted = true;
                    });
                });
                dt.on('event', function (ev) {
                    var elapsed = Date.now() - since;
                    evts.forEach(function (evt) {
                        if (evt.msg.msg === ev.msg) {
                            numRcvd++;
                            evt.elapsed = elapsed;
                            evt.rcvd = ev;
                            evt.order = numRcvd;
                        }
                    });
                });
                setTimeout(next, 100);
            },
            function (next) {
                dt.leave(function () {
                    next();
                });
            }
        ], function (err, results) {
            void(results);
            evts.forEach(function (evt) {
                assert.ok(evt.posted);
                assert.deepEqual(evt.msg, evt.rcvd);
                assert(evt.elapsed < evt.delay + 200);
                assert(evt.elapsed > evt.delay);
            });
            assert.equal(numRcvd, evts.length);
            done(err);
        });
    });

    it('Post and receive many events', function (done) {
        var evts = [
            { msg: { msg: 'msg0' }, delay: 50 },
            { msg: { msg: 'msg1' }, delay: 50 },
            { msg: { msg: 'msg2' }, delay: 50 },
            { msg: { msg: 'msg3' }, delay: 50 },
            { msg: { msg: 'msg4' }, delay: 50 },
            { msg: { msg: 'msg5' }, delay: 50 },
            { msg: { msg: 'msg6' }, delay: 50 },
            { msg: { msg: 'msg7' }, delay: 50 },
            { msg: { msg: 'msg8' }, delay: 50 },
            { msg: { msg: 'msg9' }, delay: 50 }
        ];
        var numRcvd = 0;
        dt.maxEvents = 5;
        async.series([
            function (next) {
                dt.join(function () {
                    next();
                });
            },
            function (next) {
                var since = Date.now();
                evts.forEach(function (evt) {
                    dt.post(evt.msg, evt.delay, function (err, evId) {
                        evt.id = evId;
                        evt.postDelay = Date.now() - since;
                        evt.posted = true;
                    });
                });
                dt.on('event', function (ev) {
                    var elapsed = Date.now() - since;
                    evts.forEach(function (evt) {
                        if (evt.msg.msg === ev.msg) {
                            numRcvd++;
                            evt.elapsed = elapsed;
                            evt.rcvd = ev;
                            evt.order = numRcvd;
                        }
                    });
                });
                setTimeout(next, 100);
            },
            function (next) {
                dt.leave(function () {
                    next();
                });
            }
        ], function (err, results) {
            void(results);
            evts.forEach(function (evt) {
                assert.ok(evt.posted);
                assert.deepEqual(evt.msg, evt.rcvd);
                assert(evt.elapsed < evt.delay + 200);
                assert(evt.elapsed > evt.delay);
            });
            assert.equal(numRcvd, evts.length);
            done(err);
        });
    });

    it('Post then cancel', function (done) {
        var evt = { msg: 'hello' };
        var delay = 500;
        async.series([
            function (next) {
                dt.join(function () {
                    next();
                });
            },
            function (next) {
                var numEvents = 0;
                dt.post(evt, delay, function (err, evId) {
                    assert.ifError(err);
                    dt.cancel(evId, function (err) {
                        assert.ifError(err);
                    });
                });
                dt.on('event', function (ev) {
                    numEvents++;
                    assert.deepEqual(ev, evt);
                });
                setTimeout(function() {
                    assert.equal(numEvents, 0);
                    next();
                }, 1000);
            },
            function (next) {
                dt.leave(function () {
                    next();
                });
            }
        ], function (err, results) {
            void(results);
            done(err);
        });
    });
});
