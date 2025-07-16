// Copyright IBM Corp. 2016,2019. All Rights Reserved.
// Node module: loopback-ibmdb
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

/* eslint-env node, mocha */
const EventEmitter = require('events').EventEmitter;
const IBMDB = require('../').IBMDB;

describe('basic connector', function() {
  const ds = new EventEmitter;
  let connection = null;

  it('can be constructed', function(done) {
    ds.connector = new IBMDB('db2', global.config);
    ds.connector.dataSource = ds;
    done();
  });

  it('can connect', function(done) {
    ds.connector.connect(function(err, conn) {
      connection = conn;
      done(err);
    });
  });

  it('can ping', function(done) {
    ds.connector.ping(done);
  });

  it('can disconnect', function(done) {
    connection.close(done);
  });
});
