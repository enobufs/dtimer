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

## API

### Class / Constructor
#### DTimer(id, pub, sub, [option]) - Inherits EventEmitter.
* {string} id - Unique ID representing this node.
* {RedisClient} pub - Redis client (main operation)
* {RedisClient} sub - Redis client for subscribe
* {object} option Options.
    * {string} ns Namespace to define a unique event notification domain. Defaults to 'dt'.
    * {number} maxEvents The maximum number of events this instance wants to received at a time. Defaults to 8. You may change this value later with the setter, `maxEvents`

### Instance method
* join(cb) - Start listening to events. 
* leave(cb)) - Stop listening to events.
* post(ev, delay, cb) - Post an event.
    * {object} ev - Event data.
        * {string} [ev.id] - User provided event ID. If not present, dtimer will automatically assigned an ID using uuid.
    * {number} delay - Delay value in milliseconds.
    * {function} cb - Callback made when the post operation is complete. The callback function takes following args:
        * {Error} err - Error object. Null is set on sucess.
        * {string} evId - Event ID assigned to the posted event. The ID is used to cancel the event.
* cancel(evId, cb) - Cancel an event by its event ID.
    * {string} evId - The event ID obtained via the callback of post() method.
* upcoming([option], cb) - Retrieve upcoming events. This method is provided for diagnostic purpose only and the use of this method in production is highly discouraged unless the number of events retrieved is reasonably small. Cost of this operation is O(N), where N is the number events that would be retrieved.
    * {object} option - Options
        * {number} offset Offset expiration time in msec from which events are retrieved . This defaults to the current (redis-server) time (-1).
        * {number} duration Time length [msec] from offset time for which events are trieved. This defaults to '+inf' (-1).
        * {number} limit Maximum number of events to be retrieved. This defaults to `no limit` (-1)
    * {function} cb - Callback made when upcoming operation is complete. The callback function takes following args:
         * {Error} err - Error object. Null is set on success.
         * {object} events - List of objects that met the given criteria.
Example of retrieved events by upcoming():

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
* Event: 'event' - Emitted when an event is received.
* Event: 'error' - Emitted when an error occurred.

## Example

```js
var DTimer = require('dtimer').DTimer;
var redis = require('redis');
var pub = redis.createClient();
var sub = redis.createClient();
var dt = new DTimer('ch1', pub, sub)
dt.on('event', function (ev) {
	// do something with ev
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
dt.post({id: 'myId', msg:'hello'}, 200, function (err, evId) {
	if (err) {
		// failed to post event
		return;
	}
	// posted event successfully
	// If you need to cancel this event, then do:
	//dt.cancel('myId', function (err) {...});
    // Note: evId === 'myId'
})
```
## Tips

* You do not have to join to post. By calling `join()`, you are declaring yourself as a listener to consume due events.
* Under the hood, more than one event may be retrieved. You may change the maximum number of events (using the setter, DTimer#maxEvents) to be retrieved at once to optimize memory usage and/or overall performance.
* To control incoming event traffic, use DTimer#leave() and then DTimer#join() again. Note that you may still receive some events after calling leave() if there are remaing events inside DTimer that have already been received from Redis.
