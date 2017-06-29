// Copyright IBM Corp. 2016. All Rights Reserved.
// Node module: loopback-connector-db2
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

/* eslint-env node, mocha */
process.env.NODE_ENV = 'test';
var assert = require('assert');
var EventEmitter = require('events').EventEmitter;
var IBMDB = require('../').IBMDB;

var db = new EventEmitter;

describe('functional test', function() {
  before(function(done) {
    db.connector = new IBMDB('db2', global.config);
    db.connector.dataSource = db;
    done();
  });
  it('`fromColumnValue` function', function(done) {
    var result = db.connector.fromColumnValue({}, undefined);
    assert.equal(result, undefined);
    done();
  });
});
