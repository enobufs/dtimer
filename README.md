# dtimer

Distributed timer backed by Redis.

[![NPM](https://nodei.co/npm/dtimer.png)](https://nodei.co/npm/dtimer/)
[![unstable](https://img.shields.io/badge/stability-unstable-yellowgreen.svg)](http://nodejs.org/api/documentation.html#documentation_stability_index)
[![Build Status](https://travis-ci.org/enobufs/dtimer.svg?branch=master)](https://travis-ci.org/enobufs/dtimer) 

## Why dtimer?
In a clustered server environment, you'd occasionally need to process a task after a certain period of time. The setTimeout() may not be suitable because the process may die for whatever reason, the timed events would also be lost. Ideally, you'd want to store these timed events on a central strage, then have a cluster of listeners handle the due events. If you are already using Redis, then this dtimer would be a handy solution for you.

## Installation
    $ npm install dtimer

## Features
* Realizes scheduler using Redis.
* Supports one or more event listener across cluster. (round robin)
* Pubsub based event notification (low delay and low network bandwidth usage.)


## API

### Class / Constructor
#### DTimer(id, pub, sub, [option])
Inherits EventEmitter.

* {string} id - Unique ID representing this node.
* {RedisClient} pub - Redis client (main operation)
* {RedisClient} sub - Redis client for subscribe
* {object} option Options.
    * {string} ns Namespace to define a unique event notification domain. Defaults to 'dt'.
    * {number} maxEvents The max number of maximum number of events this instance wants to received at a time. Defaults to 1.

### Instance method
* join(cb) - Start listening to events.
* leave(cb)) - Stop listening to events.
* post(ev, delay, cb) - Post an event.
    * {object} ev - Event data.
    * {number} delay - Delay value in milliseconds.

### Event types
* Event: 'event' - Emitted when an event is received.
* Event: 'error' - Emitted when an error occurred.

## Example

```js
var DTimer = require('dtimer').DTimer;
var pub = redis.createClient();
var sub = redis.createClient();
var dt = new DTimer('ch1', pub, sub)
dt.on('event', function (events) {
	events.forEach(function (ev) {
		// do something with ev	});})
dt.on('error', function (err) {
	// handle error})
dt.join(function (err) {
	if (err) {
		// join failed
		return;	}
	// join successfully})
dt.post({msg:'hello'}, 200, function (err) {
	if (err) {
		// failed to post event
		return;	}
	// posted event successfully})
```

# TODO
1. Introduce 'cancel()' to cancel a specific event.
2. Add more thorogh testing
