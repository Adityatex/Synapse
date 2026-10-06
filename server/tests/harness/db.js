'use strict';

// P1-09: shared in-memory Mongo harness for vitest.
// Single MongoMemoryServer per worker; connect mongoose once, wipe between tests.

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongod = null;

async function startMemoryDb() {
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (!mongod) {
    mongod = await MongoMemoryServer.create();
  }
  const uri = mongod.getUri();
  await mongoose.connect(uri);
  return mongoose.connection;
}

async function clearMemoryDb() {
  if (mongoose.connection.readyState !== 1) return;
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

async function stopMemoryDb() {
  await mongoose.disconnect().catch(() => {});
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
}

module.exports = { startMemoryDb, clearMemoryDb, stopMemoryDb };
