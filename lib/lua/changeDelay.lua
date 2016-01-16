 -- Input parameters
 --   KEYS[1] redis key for event ID sorted-set
 --   ARGV[1] event ID to be cancelled
 --   ARGV[2] new expration time
 -- Output parameters
 --   {number} 0: event not found. 1: changed successfully.
local evId = ARGV[1]
local expireAt = tonumber(ARGV[2])
local res

-- Check if the event exists in ei table
res = redis.call("ZSCORE", KEYS[1], evId)
if res ~= nil then
    redis.call("ZADD", KEYS[1], expireAt, evId)
    return 1
end

return 0
