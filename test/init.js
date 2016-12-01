// Copyright IBM Corp. 2016. All Rights Reserved.
// Node module: loopback-connector-ibmdb
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

var DataSource = require('loopback-datasource-juggler').DataSource;

var config = {
  username: process.env.DB2_USERNAME || 'bluadmin',
  password: process.env.DB2_PASSWORD || 'YTg1MmRlODA4MjAx',
  hostname: process.env.DB2_HOSTNAME || 'dashdb-txnha-small-yp-dal10-08.services.dal.bluemix.net',
  port: process.env.DB2_PORTNUM || 50000,
  database: process.env.DB2_DATABASE || 'BLUDB',
  schema: process.env.DB2_SCHEMA || 'DB2INST1',
};

global.config = config;

global.getDataSource = global.getSchema = function(options) {
  var db = new DataSource(require('../'), config);
  return db;
};

global.connectorCapabilities = {
  ilike: false,
  nilike: false,
};
