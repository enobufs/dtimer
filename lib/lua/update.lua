 -- Input parameters
 --   KEYS[1] redis key for global hash
 --   KEYS[2] redis key for channel list
 --   KEYS[3] redis key for event ID sorted-set
 --   KEYS[4] redis key for event hash
 --   KEYS[5] redis key for notified event ID sorted-set
 --   ARGV[1] channel ID
 --   ARGV[2] current time (equivalent to TIME, in msec)
 --   ARGV[3] max number of events
 --   ARGV[4] confirmation timeout (sec)
 -- Output parameters
 --   {array} Events
 --   {number} Next (suggested) interval in milliseconds.
redis.call("HSETNX", KEYS[1], "gracePeriod", 20)
redis.call("HSETNX", KEYS[1], "baseInterval", 1000)
local events = {}
local chId = ARGV[1]
local now = tonumber(ARGV[2])
local numMaxEvents = tonumber(ARGV[3])
local confTimeout = tonumber(ARGV[4]) * 1000
local gracePeriod = tonumber(redis.call("HGET", KEYS[1], "gracePeriod"))
local baseInterval = tonumber(redis.call("HGET", KEYS[1], "baseInterval"))
local numChs = tonumber(redis.call("LLEN", KEYS[2]))
local defaultInterval = numChs * baseInterval
local numEvents
local ev
local evIds
local evId
local evStr

redis.log(redis.LOG_DEBUG,"numChs=" .. numChs)
redis.log(redis.LOG_DEBUG,"confTimeout=" .. confTimeout)

-- Put confirmation timed out events back into ei/ed tables.
numEvents = redis.call("ZCARD", KEYS[5])
if numEvents > 0 then
    evIds = redis.call("ZRANGEBYSCORE", KEYS[5], 0, now)
    if #evIds > 0 then
        redis.call("ZREMRANGEBYRANK", KEYS[5], 0, #evIds - 1)
        for i=1, #evIds do
            evId = evIds[i]
            evStr = redis.call("HGET", KEYS[4], evId)
            if evStr ~= nil then
                if pcall(function () ev = cjson.decode(evStr) end) then
                    if ev._numRetries < ev.maxRetries then
                        ev._numRetries = ev._numRetries + 1
                        redis.call("ZADD", KEYS[3], now, evId)
                        redis.call("HSET", KEYS[4], evId, cjson.encode(ev))
                    else
                        redis.call("HDEL", KEYS[4], evId)
                    end
                else
                    redis.call("HDEL", KEYS[4], evId)
                end
            end
        end
    end
end

if numMaxEvents > 0 then
    evIds = redis.call("ZRANGEBYSCORE", KEYS[3], 0, now, "LIMIT", 0, numMaxEvents)
    if #evIds > 0 then
        redis.call("ZREMRANGEBYRANK", KEYS[3], 0, #evIds - 1)
        for i=1, #evIds do
            evId = evIds[i]
            evStr = redis.call("HGET", KEYS[4], evId)
            if evStr ~= nil then
                if pcall(function () ev = cjson.decode(evStr) end) then
                    table.insert(events, evStr)
                    if ev.maxRetries > 0 then
                        -- Ensure maxRetries and _numRetries properties
                        if ev.maxRetries == nil or ev._numRetries == nil then
                            if ev.maxRetries == nil then
                                ev.maxRetries = 0
                            end
                            if ev._numRetries == nil then
                                ev._numRetries = 0
                            end
                            redis.call("HSET", KEYS[4], evId, cjson.encode(ev))
                        end

                        -- Put it into et table while waiting for confirmation
                        redis.call("ZADD", KEYS[5], now+confTimeout, evId)
                    else
                        redis.call("HDEL", KEYS[4], evId)
                    end
                else
                    redis.call("HDEL", KEYS[4], evId)
                end
            end
        end

        if redis.call("LINDEX", KEYS[2], numChs-1) == chId then
            if numChs > 1 then
                redis.call("RPOPLPUSH", KEYS[2], KEYS[2])
            end
            redis.call("HDEL", KEYS[1], "expiresAt")
        end
    end
end

numEvents = redis.call("ZCARD", KEYS[3])
if numEvents == 0 then
    redis.call("HDEL", KEYS[1], "expiresAt")
else
    local notify = true
    local nexp = tonumber(redis.call("ZRANGE", KEYS[3], 0, 0, "WITHSCORES")[2])
    if redis.call("HEXISTS", KEYS[1], "expiresAt") == 1 then
        local cexp = tonumber(redis.call("HGET", KEYS[1], "expiresAt"))
        if cexp > nexp and cexp - nexp > gracePeriod then
            redis.call("HDEL", KEYS[1], "expiresAt")
        else
            notify = false
        end
    end
    if numChs > 0 and notify then
        local interval = 0
        if nexp > now then
            interval = nexp - now
        end
        if interval + gracePeriod < defaultInterval then
            while numChs > 0 do
                chId = redis.call("LINDEX", KEYS[2], numChs-1)
                local ret = redis.call("PUBLISH", chId, '{"interval":' .. interval .. '}')
                if ret > 0 then
                    redis.call("HSET", KEYS[1], "expiresAt", nexp)
                    break
                end
                redis.call("RPOP", KEYS[2])
                numChs = tonumber(redis.call("LLEN", KEYS[2]))
            end
        end
    end
end

return {events, defaultInterval}
