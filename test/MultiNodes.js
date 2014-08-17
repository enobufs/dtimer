
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

    it('MaxEvents 1 - each node receives 1 event', function (done) {
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
        // Set up each node to grab 1 event at a time.
        nodes.forEach(function (node) {
            node.dt.maxEvents = 1;
        });
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
            evts.forEach(function (evt) {
                nodes[0].dt.post(evt.msg, evt.delay, function (err, evId) {
                    evt.id = evId;
                    evt.postDelay = Date.now() - since;
                    evt.posted = true;
                });
            });
            nodes.forEach(function (node) {
                node.dt.on('event', function (ev) {
                    node.numRcvd++;
                    var elapsed = Date.now() - since;
                    evts.forEach(function (evt) {
                        if (evt.msg.msg === ev.msg) {
                            numRcvd++;
                            evt.elapsed = elapsed;
                            evt.rcvd = ev;
                            evt.rcvdBy = node.id;
                            evt.order = numRcvd;
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
            evts.forEach(function (evt) {
                assert.ok(evt.posted);
                assert.deepEqual(evt.msg, evt.rcvd);
                assert(evt.elapsed < evt.delay + 200);
                assert(evt.elapsed > evt.delay);
            });
            assert.equal(numRcvd, evts.length);
            nodes.forEach(function (node) {
                assert.equal(node.numRcvd, 1);
            });
            done();
        });
    });

    it('MaxEvents 2 - each node receives 0 or 2 events', function (done) {
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
        // Set up each node to grab 1 event at a time.
        nodes.forEach(function (node) {
            node.dt.maxEvents = 2;
        });
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
            evts.forEach(function (evt) {
                nodes[0].dt.post(evt.msg, evt.delay, function (err, evId) {
                    evt.id = evId;
                    evt.postDelay = Date.now() - since;
                    evt.posted = true;
                });
            });
            nodes.forEach(function (node) {
                node.dt.on('event', function (ev) {
                    node.numRcvd++;
                    var elapsed = Date.now() - since;
                    evts.forEach(function (evt) {
                        if (evt.msg.msg === ev.msg) {
                            numRcvd++;
                            evt.elapsed = elapsed;
                            evt.rcvd = ev;
                            evt.rcvdBy = node.id;
                            evt.order = numRcvd;
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
            evts.forEach(function (evt) {
                assert.ok(evt.posted);
                assert.deepEqual(evt.msg, evt.rcvd);
                assert(evt.elapsed < evt.delay + 200);
                assert(evt.elapsed > evt.delay);
            });
            assert.equal(numRcvd, evts.length);
            nodes.forEach(function (node) {
                if (node.numRcvd > 0) {
                    assert.equal(node.numRcvd, 2);
                }
            });
            done();
        });
    });
});
