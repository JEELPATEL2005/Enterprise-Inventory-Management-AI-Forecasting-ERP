const fs = require("fs");
const path = require("path");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

module.exports = async () => {
  const replSet = new MongoMemoryReplSet({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await replSet.start();
  const uri = replSet.getUri();
  global.__MONGO_REPLSET__ = replSet;
  process.env.MONGO_URI = uri;
  process.env.JWT_SECRET = "test-jwt-secret-key-never-use-in-production-2026";
  process.env.JWT_EXPIRES_IN = "15m";
  process.env.NODE_ENV = "test";

  fs.writeFileSync(path.join(__dirname, ".mongo-uri"), uri, "utf-8");
};
