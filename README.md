# dtimer
[![NPM](https://nodei.co/npm/dtimer.png?compact=true)](https://nodei.co/npm/dtimer/)

[![unstable](https://img.shields.io/badge/stability-unstable-yellowgreen.svg)](http://nodejs.org/api/documentation.html#documentation_stability_index)
[![Build Status](https://travis-ci.org/enobufs/dtimer.svg?branch=master)](https://travis-ci.org/enobufs/dtimer) 

Distributed timer backed by Redis.

## Why dtimer?
In a clustered server environment, you'd occasionally need to process a task after a certain period of time. The setTimeout() may not be suitable because the process may die for whatever reason, the timed events would also be lost. Ideally, you'd want to store these timed events on a central storage, then have a cluster of listeners handle the due events. If you are already using Redis, then this dtimer would be a handy solution for you.

## Installation
    $ npm install dtimer

## Features
* Realizes scheduler using Redis.
* Supports one or more event listener across cluster. (round robin)
* Pubsub based event notification (low delay and low network bandwidth usage.)


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
    * {number} delay - Delay value in milliseconds.
    * {function} cb - Callback made when the post operation is complete. The callback function takes following args:
        * {Error} err - Error object. Null is set on sucess.
        * {number} evId - Event ID assigned to the posted event. The ID is used to cancel the event.
* cancel(evId, cb) - Cancel an event by its event ID.
    * {number} evId - The event ID obtained via the callback of post() method.

### Instance member (getter/setter)
* {number} maxEvents (getter&setter) - The max number of events this node can grab at a time. The attempt to set it to 0 or negative value result in setting it to the original value supplied in the option field, or the default (8).


### Event types
* Event: 'event' - Emitted when an event is received.
* Event: 'error' - Emitted when an error occurred.

## Example

```js
var DTimer = require('dtimer').DTimer;
var pub = redis.createClient();
var sub = redis.createClient();
var dt = new DTimer('ch1', pub, sub)
dt.on('event', function (ev) {
	// do something with ev})
dt.on('error', function (err) {
	// handle error})
dt.join(function (err) {
	if (err) {
		// join failed
		return;	}
	// join successfully})
dt.post({msg:'hello'}, 200, function (err, evId) {
	if (err) {
		// failed to post event
		return;	}
	// posted event successfully
	// If you need to cancel this event, then do:
	//dt.cancel(evId, function (err) {...});})
```
