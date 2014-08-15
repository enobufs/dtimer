
var DTimer = require('..').DTimer;
var logger = require('..').logger;
var redis = require("redis");
var async = require('async');
var assert = require('assert');

logger.debug = console.log;
logger.warn = console.warn;
logger.info = console.info;
logger.error = console.error;

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
                    if (err) { return void(done(err)); };
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
        var ev = { msg: 'hello' };
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
            dt.post(ev, delay, function (err, evId) {
                assert.ifError(err);
            });
            dt.on('event', function (events) {
                var elapsed = Date.now() - since;
                numEvents++;
                assert.deepEqual(events[0], ev);
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
        }], function (err, results) {
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
            evts.forEach(function (ev) {
                dt.post(ev.msg, ev.delay, function (err, evId) {
                    ev.id = evId;
                    ev.postDelay = Date.now() - since;
                    ev.posted = true;
                });
            });
            dt.on('event', function (events) {
                var elapsed = Date.now() - since;
                assert.equal(events.length, 1);
                evts.forEach(function (ev) {
                    if (ev.msg.msg === events[0].msg) {
                        numRcvd++;
                        ev.elapsed = elapsed;
                        ev.rcvd = events[0];
                        ev.order = numRcvd;
                    }
                });
            });
            setTimeout(next, 100);
        },
        function (next) {
            dt.leave(function () {
                next();
            });
        }], function (err, results) {
            void(results);
            evts.forEach(function (ev) {
                assert.ok(ev.posted);
                assert.deepEqual(ev.msg, ev.rcvd);
                assert(ev.elapsed < ev.delay + 200);
                assert(ev.elapsed > ev.delay);
            });
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
        dt.setMaxEvents(5);
        async.series([
        function (next) {
            dt.join(function () {
                next();
            });
        },
        function (next) {
            var since = Date.now();
            evts.forEach(function (ev) {
                dt.post(ev.msg, ev.delay, function (err, evId) {
                    ev.id = evId;
                    ev.postDelay = Date.now() - since;
                    ev.posted = true;
                });
            });
            dt.on('event', function (events) {
                var elapsed = Date.now() - since;
                assert.equal(events.length, 5);
                for (var i = 0; i < events.length; ++i) {
                    evts.forEach(function (ev) {
                        if (ev.msg.msg === events[i].msg) {
                            numRcvd++;
                            ev.elapsed = elapsed;
                            ev.rcvd = events[i];
                            ev.order = numRcvd;
                        }
                    });
                }
            });
            setTimeout(next, 100);
        },
        function (next) {
            dt.leave(function () {
                next();
            });
        }], function (err, results) {
            void(results);
            evts.forEach(function (ev) {
                assert.ok(ev.posted);
                assert.deepEqual(ev.msg, ev.rcvd);
                assert(ev.elapsed < ev.delay + 200);
                assert(ev.elapsed > ev.delay);
            });
            done(err);
        });
    });
});
