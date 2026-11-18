const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-key-never-use-in-production-2026";
  process.env.JWT_EXPIRES_IN = "15m";

  let uri = process.env.MONGO_URI;
  const uriFile = path.join(__dirname, ".mongo-uri");
  if ((!uri || uri === "mongodb-memory-server") && fs.existsSync(uriFile)) {
    uri = fs.readFileSync(uriFile, "utf-8").trim();
    process.env.MONGO_URI = uri;
  }

  if (mongoose.connection.readyState === 0 && uri) {
    await mongoose.connect(uri);
  }

  const { seedTestDatabase } = require("./helpers/testHelpers");
  await seedTestDatabase();
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
  }
});
