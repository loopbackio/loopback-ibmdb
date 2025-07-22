// Copyright IBM Corp. 2016,2019. All Rights Reserved.
// Node module: loopback-ibmdb
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

const DataSource = require('loopback-datasource-juggler').DataSource;

const config = {
  username: process.env.DB2_USERNAME || 'db2inst1',
  password: process.env.DB2_PASSWORD || 'password',
  hostname: process.env.DB2_HOSTNAME || 'localhost',
  port: process.env.DB2_PORTNUM || 60000,
  database: process.env.DB2_DATABASE || 'testdb',
  schema: process.env.DB2_SCHEMA || 'STRONGLOOP',
};

global.config = config;

global.getDataSource = global.getSchema = function(options) {
  const db = new DataSource(require('../'), config);
  return db;
};

global.connectorCapabilities = {
  ilike: false,
  nilike: false,
};
