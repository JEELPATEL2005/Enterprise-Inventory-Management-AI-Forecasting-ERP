const fs = require("fs");
const path = require("path");

module.exports = async () => {
  if (global.__MONGO_REPLSET__) {
    await global.__MONGO_REPLSET__.stop();
  }
  const uriFile = path.join(__dirname, ".mongo-uri");
  if (fs.existsSync(uriFile)) {
    try {
      fs.unlinkSync(uriFile);
    } catch (e) {
      // ignore
    }
  }
};
