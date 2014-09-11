var DTimer = require('../..').DTimer,
    redis = require('redis'),
    pub = redis.createClient(),
    sub = redis.createClient(),
    dt = new DTimer('ch1', pub, sub),
    postTime;
var debug = require('debug')('issue_003');

require('date-utils');

postTime = new Date().addSeconds(2);

dt.on('event', function (ev) {
    debug('EV', ev);
    dt.leave(function(){
        debug('leaving and quiting.');
        pub.quit();
        sub.quit();
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

dt.post({msg:'howdy'}, postTime.getTime()-new Date().getTime(), function (err, evId) {
    if (err) {
        // failed to post event
        return;
    }

    debug('posted #id',evId,' time:',postTime);
    // posted event successfully
    // If you need to cancel this event, then do:
    //dt.cancel(evId, function (err) {...});
});

