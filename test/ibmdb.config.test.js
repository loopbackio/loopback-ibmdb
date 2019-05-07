// Copyright IBM Corp. 2016,2017. All Rights Reserved.
// Node module: loopback-ibmdb
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

'use strict';

/* eslint-env node, mocha */
process.env.NODE_ENV = 'test';
var assert = require('assert');

var config;

before(function() {
  config = global.config;
});

describe('testConfiguration', function() {
  it('test config exists', function(done) {
    assert(config);
    done();
  });
});
