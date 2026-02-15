CREATE DATABASE IF NOT EXISTS test_performance;

DROP TABLE IF EXISTS test_performance.hits_1m;

-- Create a table with specific characteristics for testing:
-- 1. Partitioning (to test partition storage analysis)
-- 2. TTL (to test TTL manager)
-- 3. Inefficient column (RandomData) for low compression detection
-- 4. Sufficient cardinality for Group By profiling
CREATE TABLE test_performance.hits_1m (
    URL String,
    Referer String,
    EventTime DateTime,
    UserID UInt64,
    OS String,
    Browser String,
    ResponseTimeMs UInt32,
    RandomData String,
    UserAgent String
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(EventTime)
ORDER BY (EventTime, URL)
TTL EventTime + INTERVAL 3 MONTH DELETE
SETTINGS index_granularity = 8192;

-- Populate with ~1 million rows
-- Using random generation to simulate realistic web log data
INSERT INTO test_performance.hits_1m
SELECT
    concat('https://example.com/page/', toString(rand() % 1000)) as URL,
    concat('https://google.com/search?q=', toString(rand() % 10000)) as Referer,
    now() - rand() % 5000000 as EventTime, -- Spread over ~2 months
    rand64() as UserID,
    multiIf(rand() % 3 == 0, 'Windows', rand() % 3 == 1, 'macOS', 'Linux') as OS,
    multiIf(rand() % 3 == 0, 'Chrome', rand() % 3 == 1, 'Firefox', 'Safari') as Browser,
    rand() % 1000 as ResponseTimeMs,
    randomPrintableASCII(50) as RandomData, -- Hard to compress
    concat(
        multiIf(rand() % 3 == 0, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ', rand() % 3 == 1, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ', 'Mozilla/5.0 (X11; Linux x86_64) '),
        'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/', 
        toString(rand() % 100 + 100), 
        '.0.0.0 Safari/537.36'
    ) as UserAgent
FROM numbers(1000000);

-- Optimize to ensure parts are merged and stats are up to date
OPTIMIZE TABLE test_performance.hits_1m FINAL;
