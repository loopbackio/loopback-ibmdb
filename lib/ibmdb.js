// Copyright IBM Corp. 2016. All Rights Reserved.
// Node module: loopback-connector-ibmdb
// This file is licensed under the Artistic License 2.0.
// License text available at https://opensource.org/licenses/Artistic-2.0

/*!
 * Common connector infrastructure for IBM database connectors.
 */
var SQLConnector = require('loopback-connector').SQLConnector;
var Driver = require('ibm_db');
var util = require('util');
var debug = require('debug')('loopback:connector:ibmdb');
var async = require('async');

module.exports = IBMDB;

IBMDB.ParameterizedSQL = SQLConnector.ParameterizedSQL;

/**
 * The constructor for the IBMDB LoopBack connector
 *
 * @param {Object} settings The settings object
 * @constructor
 */
function IBMDB(name, settings) {
  debug('IBMDB constructor settings: %j', settings);
  SQLConnector.call(this, name, settings);
  this.debug = settings.debug || debug.enabled;
  this.client = new Driver.Pool();
  this.dbname = (settings.database || settings.db || 'testdb');
  this.dsn = settings.dsn;
  this.hostname = (settings.hostname || settings.host);
  this.username = (settings.username || settings.user);
  this.password = settings.password;
  this.portnumber = settings.port;
  this.protocol = (settings.protocol || 'TCPIP');

  var dsn = settings.dsn;
  if (dsn) {
    this.connStr = dsn;

    var DSNObject = parseDSN(dsn);
    if (!('CurrentSchema' in DSNObject)) {
      this.connStr += ';CurrentSchema=' + DSNObject.UID;
    }
    this.schema = DSNObject.CurrentSchema || DSNObject.UID;
  } else {
    var connStrGenerate =
      'DRIVER={' + name + '}' +
      ';DATABASE=' + this.dbname +
      ';HOSTNAME=' + this.hostname +
      ';UID=' + this.username +
      ';PWD=' + this.password +
      ';PORT=' + this.portnumber +
      ';PROTOCOL=' + this.protocol;
    this.connStr = connStrGenerate;

    this.schema = this.username;
    if (settings.schema) {
      this.connStr += ';CurrentSchema=' + settings.schema;
      this.schema = settings.schema.toUpperCase();
    }
  }
};

util.inherits(IBMDB, SQLConnector);

function parseDSN(dsn) {
  // Split dsn into an array of optionStr
  var dsnOption = dsn.split(';');
  // Handle dsn string ended with ';'
  if (!dsnOption[dsnOption.length - 1]) {
    dsnOption.pop();
  }

  // Convert Array<String> into Object
  var result = {};
  dsnOption.forEach(function(str) {
    var strSplit = str.split('=');
    result[strSplit[0]] = strSplit[1];
  });

  return result;
}

IBMDB.prototype.tableEscaped = function(model) {
  var escapedName = this.escapeName(this.table(model));
  return escapedName;
};

IBMDB.prototype.ping = function(cb) {
  var self = this;

  if (self.dataSource.connection) {
    if (!self.testConnection(self.dataSource.connection)) {
      return cb && cb(Error('Failed to use connection'));
    }
    cb && cb();
  } else {
    self.connect(function(err, conn) {
      if (err) {
        cb && cb(Error(err));
      } else if (!self.testConnection(conn)) {
        cb && cb(Error('Failed to use connection'));
      } else {
        cb && cb();
      }
    });
  }

  return;
};

/**
 * Connect to IBM database.
 *
 * {Function} [cb] The callback after the connect
 */
IBMDB.prototype.connect = function(cb) {
  var self = this;

  if (!self.dsn && (!self.hostname ||
      !self.portnumber ||
      !self.username ||
      !self.password ||
      !self.protocol)) {
    console.log('Invalid connection string: ', self.connStr);
    return (cb && cb());
  }

  self.dataSource.connecting = true;
  self.client.open(this.connStr, function(err, con) {
    debug('IBMDB.prototype.connect (%s) err=%j con=%j', self.connStr, err, con);
    if (err) {
      self.dataSource.connected = false;
      self.dataSource.connecting = false;
    } else {
      self.connection = con;
      self.dataSource.connected = true;
      self.dataSource.connecting = false;
      self.dataSource.emit('connected');
    }
    cb && cb(err, con);
  });
};
