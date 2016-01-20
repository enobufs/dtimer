# dtimer

[![NPM version](https://badge.fury.io/js/dtimer.svg)](http://badge.fury.io/js/dtimer)
[![Build Status](https://travis-ci.org/enobufs/dtimer.svg?branch=master)](https://travis-ci.org/enobufs/dtimer) 
[![Coverage Status](https://coveralls.io/repos/enobufs/dtimer/badge.png?branch=master)](https://coveralls.io/r/enobufs/dtimer?branch=master)

Distributed timer backed by Redis.

## Why dtimer?
In a clustered server environment, you'd occasionally need to process a task after a certain period of time. The setTimeout() may not be suitable because the process may die for whatever reason, the timed events would also be lost. Ideally, you'd want to store these timed events on a central storage, then have a cluster of listeners handle the due events. If you are already using Redis, then this dtimer would be a handy solution for you.

## Installation
    $ npm install dtimer

## Features
* Timed event emitter and listener across cluster using Redis.
* Supports one or more event listeners across cluster. (round robin)
* Pubsub based event notification (low delay and low network bandwidth usage.)

## Requirements
* Requires Redis version 2.6.0 or later (dtimer uses lua)
* The redis module NUST be promisified at module level in advance, even legacy callback style is used.
```js
var Promise = require('bluebird');
var redis = Promise.promisifyAll(require('redis'));
```

## API

### Class / Constructor
#### DTimer(id, pub, sub, [option]) - Inherits EventEmitter.
* {string} id - Unique ID representing this node.
* {RedisClient} pub - Redis client (main operation)
* {RedisClient} sub - Redis client for subscribe
* {object} option Options.
    * {string} ns Namespace to define a unique event notification domain. Defaults to 'dt'.
    * {number} maxEvents The maximum number of events this instance wants to received at a time. Defaults to 8. You may change this value later with the setter, `maxEvents`
    * {number} confTimeout Confirmation wait timeout in seconds. Defaults to 10 [sec].

> The redis module MUST be promsified before instantiating clients for `pub` and `sub`. See the example below.

### Instance method
#### join() - Start listening to events. 
```
join([cb]) => {Promise}
    * cb {function} Optional callback.
    * returns Promise if cb is not supplied.
```

#### leave() - Stop listening to events.
```
leave([cb]) => {Promise}
    * cb {function} Optional callback.
    * returns Promise if cb is not supplied.
```

#### post() - Post an event.
```
post(ev, delay [, cb]) => {Promise}
    * {object} ev - Event data.
        * {string} [ev.id] - User provided event ID. If not present, dtimer will automatically
          assign an ID using uuid.
        * {number} [ev.maxRetries] - Maximum number of retries that occur if confirm() is not
          made within confTimeout [sec]. If not present, it defaults to 0 (no retry).
    * {number} delay - Delay value in milliseconds.
    * {function} [cb] - Callback made when the post operation is complete.
    * returns Promise if cb is not supplied.
        * Resolved value: evId {string} - Event ID assigned to the posted event. If ev object
          already had id property, this evId is identical to ev.id always.
```

> The `ev` object may have user-defined properties as its own properties, however, the following properties are reserved and used by dtimer; 'id', 'maxRetries' and '_numRetries'. If your appkication needs to use these names (for application specific use), then consider putting all user-defined event object inside the `ev` like this:

```js
{
    id: '25723fdd-4434-4cbd-b579-4693e221ec73',
    maxRetries: 3,
    // _numRetries: 0 // added by dtimer before the event was fired
    data: { /*...*/ } // user-defined event object
}
```


#### peek() - Peek an event scheduled.
```
peek(evId [, cb]) => {Promise}
    * {string} evId - The event ID to be canceled.
    * {function} [cb] - Callback made when the operation is complete.
    * returns Promise if cb is not supplied.
        * Resolved value: results {array} An array of results.
            * results[0] {number} Time to expire in milliseconds, or null if the event does
              not exit.
            * results[1] {object} Event object, or null if the event does not exit.
```

#### cancel() - Cancel an event by its event ID.
```
cancel(evId [, cb]) => {Promise}
    * {string} evId - The event ID to be canceled.
    * {function} [cb] - Callback made when the operation is complete.
    * returns Promise if cb is not supplied.
        * Resolved value {number} 0: the event ID not found. 1: the event has been canceled.
```

#### confirm() - Confirm that specified event has been processed.
```
confirm(evId [, cb])
    * {string} evId - The event ID to be canceled.
    * {function} [cb] - Callback made when the operation is complete.
    * returns Promise if cb is not supplied.
        * Resolved value {number} 0: the event ID not found. 1: the event has been confirmed.
```

#### changeDelay() - Change delay of specified event.
```
changeDelay(evId, delay, [, cb]) => {Promise}
    * {string} evId - The event ID for which the delay will be changed.
    * {number} delay - New delay (in milliseconds relative to the current time).
    * {function} [cb] - Callback made when the operation is complete.
    * returns Promise if cb is not supplied.
        * Resolved value {number} 0: the event ID not found. 1: the delay has been updated.
```

#### upcoming() - Retrieve upcoming events.
This method is provided for diagnostic purpose only and the use of this method in production is highly discouraged unless the number of events retrieved is reasonably small. Cost of this operation is O(N), where N is the number events that would be retrieved.
```
upcoming([option] [, cb]) => {Promise}
    * {object} option - Options
        * {number} offset Offset expiration time in msec from which events are retrieved.
          This defaults to the current (redis-server) time (-1).
        * {number} duration Time length [msec] from offset time for which events are
          retrieved. This defaults to '+inf' (-1).
        * {number} limit Maximum number of events to be retrieved. This defaults to
          `no limit` (-1).
    * {function} [cb] - Callback made when upcoming operation is complete.
      The callback function takes following args:
         * {Error} err - Error object. Null is set on success.
         * {object} events - List of objects that met the given criteria.
    * returns Promise if cb is not supplied.
```

##### Example of retrieved events by upcoming():

```
{
    "25723fdd-4434-4cbd-b579-4693e221ec73": {
        "expireAt": 1410502530320,
        "event": {
            "msg": "hello"
        }
    },
    "24bbef35-8014-4107-803c-5ff4b858a5ad": {
        "expireAt": 1410502531321,
        "event": {
            "msg": "hello"
        }
    }
}
```


### Instance member (getter/setter)
* {number} maxEvents (getter&setter) - The max number of events this node can grab at a time. The attempt to set it to 0 or negative value result in setting it to the original value supplied in the option field, or the default (8).


### Event types

#### Event: 'event' - Emitted when an event is received.
The handler will be called with the following argument:

```
* ev {object} Event object.
* ev.id {string} Event ID.
* ev.maxRetries {number} Max retries specified when this event was posted.
* ev._numRetries {number} Number of retries made before this event occured.
```

#### Event: 'error' - Emitted when an error occurred.
The handler will be called with the following argument:

```
* err {Error} Error object.
```

## Example

```js
var DTimer = require('dtimer').DTimer;
var Promise = require('bluebird');
var redis = Promise.promisifyAll(require('redis')); // module level promisification
var pub = redis.createClient();
var sub = redis.createClient();
var dt = new DTimer('ch1', pub, sub)
dt.on('event', function (ev) {
	// do something with ev

    // If the posted event has `maxRetries` property set to a number greater than 0,
    // you must call confirm() with its event ID. If not confirmed, the event will
    // fire in `confTimeout` (default 10 sec) again, until the number of retries
    // becomes `maxRetries`.
    dt.confirm(ev.id, function (err) {
        // confirmed.
    });
})
dt.on('error', function (err) {
	// handle error
})
dt.join(function (err) {
	if (err) {
		// join failed
		return;
	}
	// join successfully
})
dt.post({id: 'myId', maxRetries: 3, msg:'hello'}, 200, function (err) {
	if (err) {
		// failed to post event
		return;
	}
	// posted the event successfully

	// If you need to cancel this event, then do:
	//dt.cancel('myId', function (err) {...});
})
```

## Tips

* You do not have to join to post. By calling `join()`, you are declaring yourself as a listener to consume due events.
* Under the hood, more than one event may be retrieved. You may change the maximum number of events (using the setter, DTimer#maxEvents) to be retrieved at once to optimize memory usage and/or overall performance.
* To control incoming event traffic, use DTimer#leave() and then DTimer#join() again. Note that you may still receive some events after calling leave() if there are remaining events inside DTimer that have already been received from Redis.
