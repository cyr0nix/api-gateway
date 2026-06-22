// runs before any test file imports the app, so config picks these up.
// upstream service ports here are the fake upstreams the proxy tests spin up.
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-secret-that-is-definitely-long-enough-123456";
process.env.LOG_LEVEL = "silent";
process.env.REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
process.env.REDIS_PORT = process.env.REDIS_PORT || "6379";
process.env.PRODUCT_SERVICE_URL = "http://127.0.0.1:4101";
process.env.USER_SERVICE_URL = "http://127.0.0.1:4102";
process.env.ORDER_SERVICE_URL = "http://127.0.0.1:4103";
// keep proxy/breaker timeouts short so failure-path tests are fast
process.env.PROXY_TIMEOUT = "1000";
process.env.CB_RESET_TIMEOUT = "500";
