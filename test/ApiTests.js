
var DTimer = require('..').DTimer;
var redis = require("redis");
var async = require('async');
var assert = require('assert');
var sinon = require('sinon');

describe('ApiTests', function () {
    var pub = null;
    var sub = null;
    var dt  = null;
    var sandbox = sinon.sandbox.create();
    var clock;

    before(function () {
        sandbox = sinon.sandbox.create();
    });

    beforeEach(function () {
        clock = null;
    });

    afterEach(function () {
        sandbox.restore();
        if (clock) {
            clock.restore();
        }
    });

    it('The pub should not be null', function () {
        assert.throws(function () {
            new DTimer('me', null);
        },
        function (err) {
            return (err instanceof Error);
        },
            "unexpected error"
        );
    });

    it('When sub is present, id must be non-empty string', function () {
        var pub = redis.createClient();
        var sub = redis.createClient();
        function shouldThrow(id) {
            assert.throws(function () {
                new DTimer(id, pub, sub);
            },
            function (err) {
                return (err instanceof Error);
            },
                "unexpected error"
            );
        }
        // Should not be undefined
        shouldThrow(void(0));
        // Should not be null
        shouldThrow(null);
        // Should not be a number
        shouldThrow(1);
        // Should not be empty string
        shouldThrow('');
    });

    it('maxEvents - defaults to 8', function () {
        var pub = redis.createClient();
        var dt = new DTimer('me', pub, null);
        assert.strictEqual(dt.maxEvents, 8);
    });
    it('maxEvents - use option to change default', function () {
        var pub = redis.createClient();
        var dt = new DTimer('me', pub, null, { maxEvents:4 });
        assert.strictEqual(dt.maxEvents, 4);
    });
    it('maxEvents - reset to default by setting with 0', function () {
        var pub = redis.createClient();
        var dt = new DTimer('me', pub, null);
        assert.strictEqual(dt.maxEvents, 8);
        dt.maxEvents = 3;
        assert.strictEqual(dt.maxEvents, 3);
        dt.maxEvents = 0;
        assert.strictEqual(dt.maxEvents, 8);
        dt.maxEvents = 12;
        assert.strictEqual(dt.maxEvents, 12);
        dt.maxEvents = -1;
        assert.strictEqual(dt.maxEvents, 8);
    });

    it('emits error when lured.load() fails', function (done) {
        sandbox.stub(require('lured'), 'create', function() {
            return {
                on: function () {},
                load: function (cb) {
                    process.nextTick(function () {
                        cb(new Error('fake exception'));
                    });
                }
            };
        });
        var pub = redis.createClient();
        var dt = new DTimer('me', pub, null);
        dt.on('error', function (err) {
            assert(err instanceof Error);
            done();
        });
    });

    it('Detect malformed message on subscribe', function (done) {
        sandbox.stub(require('lured'), 'create', function() {
            return {
                on: function () {},
                load: function (cb) { process.nextTick(cb); }
            };
        });
        var pub = redis.createClient();
        var dt = new DTimer('me', pub, null);
        dt.on('error', function (err) {
            assert(err instanceof Error);
            done();
        });
        dt._onSubMessage('me', "{bad");
    });

    it('Ignore invalid interval in pubsub message', function () {
        sandbox.stub(require('lured'), 'create', function() {
            return {
                on: function () {},
                load: function (cb) { process.nextTick(cb); }
            };
        });
        var pub = redis.createClient();
        var dt = new DTimer('me', pub, null);
        dt.on('error', function (err) {
            assert.ifError(err);
        });
        dt._onSubMessage('me', '{"interval":true}');
        assert.ok(!dt._timer);
    });

    it('join() should fail without sub', function (done) {
        sandbox.stub(require('lured'), 'create', function() {
            return {
                on: function () {},
                load: function (cb) { process.nextTick(cb); }
            };
        });
        var pub = redis.createClient();
        var dt = new DTimer('me', pub, null);
        dt.join(function (err) {
            assert.ok(err);
            done();
        });
    });

    it('leave() should fail without sub', function (done) {
        sandbox.stub(require('lured'), 'create', function() {
            return {
                on: function () {},
                load: function (cb) { process.nextTick(cb); }
            };
        });
        var pub = redis.createClient();
        var dt = new DTimer('me', pub, null);
        dt.leave(function (err) {
            assert.ok(err);
            done();
        });
    });

    it('join()/leave() should fail when lured state does not change in 30 secs', function (done) {
        sandbox.stub(require('lured'), 'create', function() {
            return {
                on: function () {},
                load: function (cb) { process.nextTick(cb); },
                state: 1
            };
        });
        var pub = redis.createClient();
        var sub = redis.createClient();
        var numErrs = 0;
        clock = sinon.useFakeTimers();
        var dt = new DTimer('me', pub, sub);
        dt.join(function (err) {
            assert.ok(err instanceof Error);
            numErrs++;
            if (numErrs === 2) {
                done();
            }
        });
        dt.leave(function (err) {
            assert.ok(err instanceof Error);
            numErrs++;
            if (numErrs === 2) {
                done();
            }
        });
        clock.tick(30*1000);
    });

    it('post()/cancel() should fail when lured state does not change in 30 secs', function (done) {
        sandbox.stub(require('lured'), 'create', function() {
            return {
                on: function () {},
                load: function (cb) { process.nextTick(cb); },
                state: 1
            };
        });
        var pub = redis.createClient();
        var sub = redis.createClient();
        var numErrs = 0;
        clock = sinon.useFakeTimers();
        var dt = new DTimer('me', pub, sub);
        dt.post({msg:'hi'}, 1000, function (err) {
            assert.ok(err instanceof Error);
            numErrs++;
            if (numErrs === 2) {
                done();
            }
        });
        dt.cancel(9, function (err) {
            assert.ok(err instanceof Error);
            numErrs++;
            if (numErrs === 2) {
                done();
            }
        });
        clock.tick(30*1000);
    });

    it('Attempts to post non-object event should throw', function () {
        sandbox.stub(require('lured'), 'create', function() {
            return {
                on: function () {},
                load: function (cb) { process.nextTick(cb); },
                state: 3
            };
        });
        var pub = redis.createClient();
        var dt = new DTimer('me', pub, null);
        assert.throws(function () {
            dt.post('please throw', 1000, function () {});
        },
        function (err) {
            return (err instanceof Error);
        },
            "unexpected error"
        );
    });
});
