
var DTimer = require('..').DTimer;
var redis = require("redis");
var async = require('async');
var assert = require('assert');

describe('Multiple nodes', function () {
    var numNodes = 8;
    var nodes;

    before(function () {
    });

    beforeEach(function (done) {
        nodes = [];
        function prepareNode(id, cb) {
            var node = {
                id: id,
                numRcvd: 0
            };
            async.series([
                function (next) {
                    node.pub = redis.createClient();
                    node.pub.once('ready', next);
                },
                function (next) {
                    node.sub = redis.createClient();
                    node.sub.once('ready', next);
                },
                function (next) {
                    node.pub.select(9, next);
                }
            ], function (err) {
                if (err) { return void(cb(err)); }
                node.dt = new DTimer('ch' + id, node.pub, node.sub);
                cb(null, node);
            });
        }

        async.whilst(
            function () { return (nodes.length < numNodes); },
            function (next) {
                prepareNode(nodes.length, function (err, node) {
                    if (err) { return void(next(err)); }
                    nodes.push(node);
                    next();
                });
            },
            function (err) {
                if (err) {
                    return void(done(err));
                }
                nodes[0].pub.flushdb(done);
            }
        );
    });

    afterEach(function () {
        nodes.forEach(function (node) {
            node.dt.removeAllListeners();
            node.dt = null;
            node.pub.removeAllListeners();
            node.pub.end();
            node.pub = null;
            node.sub.removeAllListeners();
            node.sub.end();
            node.sub = null;
        });
        nodes = [];
    });

    it('Post 2 events then receives one each', function (done) {
        var evts = [
            { msg: { msg: 'msg0' }, delay: 60 },
            { msg: { msg: 'msg1' }, delay: 60 },
            { msg: { msg: 'msg2' }, delay: 60 },
            { msg: { msg: 'msg3' }, delay: 60 },
            { msg: { msg: 'msg4' }, delay: 60 },
            { msg: { msg: 'msg5' }, delay: 60 },
            { msg: { msg: 'msg6' }, delay: 60 },
            { msg: { msg: 'msg7' }, delay: 60 }
        ];
        var numRcvd = 0;
        async.series([
        function (next) {
            var numJoined = 0;
            nodes.forEach(function (node) {
                node.dt.join(function (err) {
                    if (err) { return void(next(err)); }
                    numJoined++;
                    if (numJoined == nodes.length) {
                        next();
                    }
                });
            });
        },
        function (next) {
            var since = Date.now();
            evts.forEach(function (ev) {
                nodes[0].dt.post(ev.msg, ev.delay, function (err, evId) {
                    ev.id = evId;
                    ev.postDelay = Date.now() - since;
                    ev.posted = true;
                });
            });
            nodes.forEach(function (node) {
                node.dt.on('event', function (events) {
                    node.numRcvd++;
                    var elapsed = Date.now() - since;
                    assert.equal(events.length, 1);
                    evts.forEach(function (ev) {
                        if (ev.msg.msg === events[0].msg) {
                            numRcvd++;
                            ev.elapsed = elapsed;
                            ev.rcvd = events[0];
                            ev.rcvdBy = node.id;
                            ev.order = numRcvd;
                        }
                    });
                });
            });
            setTimeout(next, 100);
        },
        function (next) {
            nodes[0].pub.llen('dt:ch', function (err, reply) {
                assert.equal(reply, 8);
                next();
            });
        },
        function (next) {
            var numLeft = 0;
            nodes.forEach(function (node) {
                node.dt.leave(function () {
                    numLeft ++;
                    if (numLeft === nodes.length) {
                        next();
                    }
                });
            });
        }], function (err, results) {
            void(results);
            assert.ifError(err);
            evts.forEach(function (ev) {
                assert.ok(ev.posted);
                assert.deepEqual(ev.msg, ev.rcvd);
                assert(ev.elapsed < ev.delay + 200);
                assert(ev.elapsed > ev.delay);
            });
            nodes.forEach(function (node) {
                assert.equal(node.numRcvd, 1);
            });
            done();
        });
    });
});
