// Copyright IBM Corp. 2016. All Rights Reserved.
// Node module: loopback-connector-ibmdb
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

module.exports = require('should');

var DataSource = require('loopback-datasource-juggler').DataSource;

var config = {
  username: process.env.IBMDB_USERNAME,
  password: process.env.IBMDB_PASSWORD,
  hostname: process.env.IBMDB_HOSTNAME || 'localhost',
  port: process.env.IBMDB_PORTNUM || 60000,
  database: process.env.IBMDB_DATABASE || 'testdb',
  schema: process.env.IBMDB_SCHEMA || 'STRONGLOOP',
};

global.config = config;

global.getDataSource = global.getSchema = function(options) {
  var db = new DataSource(require('../'), config);
  return db;
};

global.sinon = require('sinon');
