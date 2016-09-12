// Copyright IBM Corp. 2016. All Rights Reserved.
// Node module: loopback-ibmdb
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

/* eslint-env node, mocha */
process.env.NODE_ENV = 'test';

require('./init');
var IBMDB = require('../').IBMDB;
var assert = require('assert');

before(function (done) {
    var connectionObj = global.config;
    var err, data;
    ibmdb = new IBMDB('db2', connectionObj);
    ibmdb.connection = {};
    ibmdb.connection.query = function(stat, callback) {
        return callback(err, data);
    };

    ibmdb.connection.connected = false;
    ibmdb.connection.connecting = false;

    ibmdb.dataSource = ibmdb.datasource = {};
    ibmdb.dataSource.connected = true;
    ibmdb.dataSource.connecting = true;
    done();
});

describe('IBMDB -> ', function () {
  describe('executeSQL -> ', function () {
    it('should set the datasource cnnected/connecting values to false', function (done) {

        var sql = '';
        var params = '';
        var options = '';

        ibmdb.connect(function (err, conn) {
            ibmdb.executeSQL(sql, params, options, function (err, data) {
                assert.equal(ibmdb.dataSource.connected, false);
                assert.equal(ibmdb.dataSource.connecting, false);
                done();
            });
        });
    });
  });
});
