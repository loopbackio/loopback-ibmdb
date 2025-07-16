// Copyright IBM Corp. 2017,2019. All Rights Reserved.
// Node module: loopback-ibmdb
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

/* eslint-env node, mocha */
process.env.NODE_ENV = 'test';
const assert = require('assert');
const EventEmitter = require('events').EventEmitter;
const IBMDB = require('../').IBMDB;

const db = new EventEmitter;

describe('functional test', function() {
  before(function(done) {
    db.connector = new IBMDB('db2', global.config);
    db.connector.dataSource = db;
    done();
  });
  it('`fromColumnValue` function', function(done) {
    const result = db.connector.fromColumnValue({}, undefined);
    assert.equal(result, undefined);
    done();
  });
  it('`toColumnValue` function returns ms in the first 3 digits of µs',
    function(done) {
      const prop = {
        type: {
          name: 'Date',
        },
      };
      const dateValue = new Date(1999, 0, 9, 10, 11, 12, 1);
      let result = db.connector.toColumnValue(prop, dateValue);
      assert.equal(result, '1999-01-09-10.11.12.001000');
      dateValue.setMilliseconds(12);
      result = db.connector.toColumnValue(prop, dateValue);
      assert.equal(result, '1999-01-09-10.11.12.012000');
      dateValue.setMilliseconds(123);
      result = db.connector.toColumnValue(prop, dateValue);
      assert.equal(result, '1999-01-09-10.11.12.123000');
      done();
    });
});
