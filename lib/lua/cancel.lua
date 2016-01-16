 -- Input parameters
 --   KEYS[1] redis key for notified event ID sorted-set
 --   KEYS[2] redis key for event hash
 --   ARGV[1] event ID to be cancelled
 -- Output parameters
 --   {number} 0: nothing cancelled. 1: cancelled.
local evId = ARGV[1]
local res

-- Remove from et table
res = redis.call("ZREM", KEYS[1], evId)
if res == 1 then
    redis.call("HDEL", KEYS[2], evId)
end

return res
