'use strict';

var DTimer = require('..').DTimer;
var assert = require('assert');
var sinon = require('sinon');
var Promise = require('bluebird');
var redis = Promise.promisifyAll(require("redis"));

describe('ApiTests', function () {
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
            var dt = new DTimer('me', null);
            void(dt);
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
                var dt = new DTimer(id, pub, sub);
                void(dt);
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
        sandbox.stub(require('lured'), 'create', function () {
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
        sandbox.stub(require('lured'), 'create', function () {
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
        sandbox.stub(require('lured'), 'create', function () {
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
        sandbox.stub(require('lured'), 'create', function () {
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
        sandbox.stub(require('lured'), 'create', function () {
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

    it('Attempts to post non-object event should throw', function () {
        sandbox.stub(require('lured'), 'create', function () {
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

    it('Attempts to post with invalid event ID should throw', function () {
        sandbox.stub(require('lured'), 'create', function () {
            return {
                on: function () {},
                load: function (cb) { process.nextTick(cb); },
                state: 3
            };
        });
        var pub = redis.createClient();
        var dt = new DTimer('me', pub, null);
        assert.throws(function () {
            dt.post({ id: 666 /*bad*/ }, 1000, function () {});
        }, Error);
    });

    it('Attempts to post with invalid maxRetries should throw', function () {
        sandbox.stub(require('lured'), 'create', function () {
            return {
                on: function () {},
                load: function (cb) { process.nextTick(cb); },
                state: 3
            };
        });
        var pub = redis.createClient();
        var dt = new DTimer('me', pub, null);
        assert.throws(function () {
            dt.post({ id: 'should throw', maxRetries: true /*bad*/ }, 1000, function () {});
        }, Error);
    });

    it('Attempts to post with delay of type string should throw', function () {
        sandbox.stub(require('lured'), 'create', function () {
            return {
                on: function () {},
                load: function (cb) { process.nextTick(cb); },
                state: 3
            };
        });
        var pub = redis.createClient();
        var dt = new DTimer('me', pub, null);
        assert.throws(function () {
            dt.post({ id: 'should throw', maxRetries: 5 }, '1000' /*bad*/, function () {});
        }, Error);
    });

    it('Attempts to changeDelay with delay of type string should throw', function () {
        sandbox.stub(require('lured'), 'create', function () {
            return {
                on: function () {},
                load: function (cb) { process.nextTick(cb); },
                state: 3
            };
        });
        var pub = redis.createClient();
        var dt = new DTimer('me', pub, null);
        assert.throws(function () {
            dt.changeDelay({ id: 'should throw', maxRetries: 5 }, '1000' /*bad*/, function () {});
        }, Error);
    });
});
